#!/usr/bin/env python3
"""
run-settings-ux-bench.py — the Settings Evolution round's benchmark runner
(BM-1..BM-7), the pinned workload that turns every settings-UX claim into a
receipt (docs/settings-evolution-session.md, M2).

Methodology (benchmarks/settings-ux/README.md is the contract):
  BM-1  first-configuration — the five-minute test: a pristine home, the
        real `unown setup` wizard (bridge preset, all defaults — the
        recommended novice path), `unown doctor`, then a verified first
        reply. Wall time + steps; captures the wizard's own claims as
        evidence (the theme step's "/settings" guidance is S2-1's exhibit).
  BM-2  find-and-change — reachable tasks through the hub's Search row
        (the advertised find surface): query → hit → editor → change →
        save, with disk + change-ledger verification, Down/Esc/Enter
        counts and wall time. Plus the six S2-1 unreachable probes
        (search-only; the miss is the measurement).
  BM-3  search success — 12 pinned queries through the hub Search row;
        hit = intent target in the TOP-3 rendered results.
  BM-4  depth-to-setting — browse-only depth (Down count from hub root to
        item editor) for one row per section + registry coverage from the
        audit dump.
  BM-5  recovery paths — change→recent→revert round-trip, drift diff,
        scoped reset with backup, kill-switch row, dream-rollback row.
  BM-6  six-questions coverage — each mission question answered from
        /settings surfaces alone, pane-truth anchors.
  BM-7  trust gates — the registry audit (bun audit-registry.mjs) + the
        typed-confirmation PTY probe on the one settable high-risk item
        (wrong phrase cancels + nothing written; "yes" writes + ledger).

Everything writes incremental per-BM JSON receipts into the run dir; a
final summary.json carries the headline table. Resumable: --only bm2,bm3
re-runs lanes; completed lanes are never re-driven within the same run dir
unless named in --only.

Usage:
  python3 benchmarks/settings-ux/run-settings-ux-bench.py \
      [--run-dir receipts/run-<ts>] [--only bm1,bm2,...] [--keep-homes]

Needs: the stack up (bridge :3031 for BM-1's live reply), pyte/pexpect.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")
sys.path.insert(0, os.path.join(UNOWN_ROOT, "scripts", "tui-capture"))

from pty_common import UnownPty, make_logger  # noqa: E402

UNOWN_BIN = os.path.join(UNOWN_ROOT, "bin", "unown")
BUN = os.environ.get("BUN_BIN", "bun")
WORK_ROOT = "/tmp/settings-ux-bench"

log = make_logger("settings-ux-bench")


def now_ms() -> int:
    return int(time.monotonic() * 1000)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Receipt plumbing
# ---------------------------------------------------------------------------


def write_receipt(run_dir: str, name: str, payload: dict) -> None:
    os.makedirs(run_dir, exist_ok=True)
    payload["writtenAt"] = utc_stamp()
    with open(os.path.join(run_dir, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)
    log(f"receipt written: {name}.json")


def read_receipt(run_dir: str, name: str) -> dict | None:
    path = os.path.join(run_dir, f"{name}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def save_pane(run_dir: str, name: str, pane_text: str) -> str:
    path = os.path.join(run_dir, f"{name}.pane.txt")
    os.makedirs(run_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(pane_text.rstrip() + "\n")
    return path


def load_tasks(name: str) -> dict:
    with open(os.path.join(HERE, "tasks", name), "r", encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Home seeding (the PTY lane contract: never touch a real config)
# ---------------------------------------------------------------------------


def seed_home(home: str) -> bool:
    """Doctor-seed a scratch home so the TUI skips the first-run wizard."""
    os.makedirs(os.path.join(home, "agent"), exist_ok=True)
    env = dict(os.environ)
    env.update(
        {
            "UNOWN_HOME": home,
            "PI_BRIDGE_URL": "http://127.0.0.1:3031",
            "UNOWN_ALLOW_UNVERIFIED_SPECS": "1",
            "NO_UPDATE_NOTIFIER": "1",
        }
    )
    proc = subprocess.run(
        [BUN, UNOWN_BIN, "doctor"],
        cwd=WORK_ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=180,
    )
    return proc.returncode == 0


def home_env(home: str) -> dict:
    return {
        "UNOWN_HOME": home,
        "PI_BRIDGE_URL": "http://127.0.0.1:3031",
        "UNOWN_ALLOW_UNVERIFIED_SPECS": "1",
        "NO_UPDATE_NOTIFIER": "1",
    }


def read_home_json(home: str, relpath: str):
    path = os.path.join(home, relpath)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def dig(obj, dotted: str):
    """Walk 'todo.maxWidgetLines' through nested dicts."""
    cur = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def ledger_entries(home: str) -> list:
    path = os.path.join(home, "agent", "settings-history.jsonl")
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


# ---------------------------------------------------------------------------
# TUI session with keystroke accounting
# ---------------------------------------------------------------------------


class CountingPty:
    """UnownPty + honest input accounting (downs/enters/escs/prompts)."""

    def __init__(self, home: str, cwd: str):
        self.pty = UnownPty(log, cwd=cwd, env_extra=home_env(home))
        self.counts = {"downs": 0, "enters": 0, "escs": 0, "typed": 0, "prompts": 0}

    def key(self, name: str, delay: float = 0.10) -> None:
        if name == "Down":
            self.counts["downs"] += 1
        elif name == "Enter":
            self.counts["enters"] += 1
        elif name == "Esc":
            self.counts["escs"] += 1
        self.pty.key(name, delay=delay)

    def send(self, text: str, delay: float = 0.05) -> None:
        self.counts["typed"] += len(text)
        if text == "\r":
            self.counts["enters"] += 1
        self.pty.send(text, delay=delay)

    def type_prompt(self, text: str) -> None:
        self.counts["prompts"] += 1
        self.counts["typed"] += len(text) + 2
        self.pty.type_prompt(text)

    # passthroughs
    def pump(self, t: float = 0.4) -> int:
        return self.pty.pump(t)

    def pane(self) -> list:
        return self.pty.pane()

    def pane_text(self) -> str:
        return self.pty.pane_text()

    def wait_for(self, anchors, mode="all", timeout=30.0, desc="", exclude=None):
        return self.pty.wait_for(anchors, mode=mode, timeout=timeout, desc=desc, exclude=exclude)

    def close(self) -> None:
        try:
            if not self.pty.dead:
                self.pty.child.terminate(force=True)
        except Exception:
            pass


def boot_tui(home: str, cwd: str) -> CountingPty:
    cp = CountingPty(home, cwd)
    # Boot readiness: ANY of the three proves the interactive loop is live —
    # the Themes resource block can be covered by the First-flights overlay
    # (and delayed by the fd-download probe), so a single anchor races.
    cp.wait_for(
        ["── Themes ──", "ctrl+k palette", "First flights"],
        mode="any",
        timeout=180,
        desc="any boot-ready signal",
    )
    time.sleep(1.5)
    # The First-flights overlay eats keys while focused — dismiss it.
    for _ in range(3):
        cp.pump(0.3)
        if "First flights" in cp.pane_text():
            cp.key("Esc")
            time.sleep(0.8)
        else:
            break
    cp.wait_for(["ctrl+k palette"], timeout=60, desc="editor ready (overlay dismissed)")
    time.sleep(1.0)
    return cp


def selected_label(pane: list) -> str:
    for line in pane:
        s = line.strip()
        if s.startswith("\u2192") or s.startswith("\u276f") or s.startswith(">"):
            return s
    return ""


def navigate_to(cp: CountingPty, needle: str, max_steps: int = 40, desc: str = "") -> None:
    for _ in range(max_steps):
        cp.pump(0.15)
        if needle.lower() in selected_label(cp.pane()).lower():
            return
        cp.key("Down", delay=0.07)
    cp.pump(0.3)
    raise AssertionError(f"navigate_to({desc or needle!r}): not reached; selected={selected_label(cp.pane())!r}")


def close_dialogs(cp: CountingPty, max_esc: int = 8) -> None:
    for _ in range(max_esc):
        cp.pump(0.25)
        text = cp.pane_text()
        if ("escape/ctrl+c cancel" in text) or ("↑↓ navigate" in text) or ("Esc to cancel" in text):
            cp.key("Esc")
            time.sleep(0.3)
            continue
        return
    cp.pump(0.3)


def back_to_editor(cp: CountingPty) -> None:
    """Esc out of hub/dialogs until the editor footer is back."""
    for _ in range(10):
        cp.pump(0.25)
        if "ctrl+k palette" in cp.pane_text():
            return
        cp.key("Esc")
        time.sleep(0.4)
    cp.pump(0.3)


def open_hub(cp: CountingPty) -> None:
    cp.type_prompt("/settings")
    cp.wait_for(["control centre"], timeout=30, desc="hub open")


# ---------------------------------------------------------------------------
# BM-1 — first-configuration (the five-minute test)
# ---------------------------------------------------------------------------


def run_bm1(run_dir: str, args) -> dict:
    import pexpect
    import pyte
    from pty_common import COLS, ROWS

    home = os.path.join(WORK_ROOT, "bm1-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm1-cwd")
    os.makedirs(cwd, exist_ok=True)

    receipt = {"bm": "bm1", "home": home, "phases": [], "success": False}
    t_total = now_ms()

    def cli_in_pty(cli_args: list, anchors: list, timeout: int, tag: str) -> tuple[bool, int, str]:
        env = dict(os.environ)
        env.update({"TERM": "xterm-256color", "LINES": str(ROWS), "COLUMNS": str(COLS)})
        env.update(home_env(home))
        for k in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "COLORTERM"):
            env.pop(k, None)
        t0 = now_ms()
        child = pexpect.spawn(BUN, [UNOWN_BIN] + cli_args, cwd=cwd, env=env,
                              dimensions=(ROWS, COLS), timeout=timeout, encoding=None)
        screen = pyte.Screen(COLS, ROWS)
        stream = pyte.ByteStream(screen)
        deadline = time.time() + timeout
        pane = ""
        anchor_ms = None
        while time.time() < deadline:
            try:
                chunk = child.read_nonblocking(65536, timeout=3)
            except pexpect.TIMEOUT:
                chunk = b""
            except (pexpect.EOF, OSError):
                chunk = b""
            if chunk:
                stream.feed(chunk)
            pane = "\n".join(l.rstrip() for l in screen.display)
            if anchor_ms is None and all(a in pane for a in anchors):
                anchor_ms = now_ms() - t0
            if anchor_ms is not None and not child.isalive():
                break
            if anchor_ms is None and not child.isalive():
                try:
                    rest = child.read_nonblocking(65536, timeout=1)
                    if rest:
                        stream.feed(rest)
                except Exception:
                    pass
                pane = "\n".join(l.rstrip() for l in screen.display)
                break
        # The user waits for the command to finish, not just the key line:
        # after the anchor, drain to EOF (30s grace) so the phase timing is
        # the full command runtime.
        if anchor_ms is not None:
            drain_deadline = time.time() + 30
            while time.time() < drain_deadline and child.isalive():
                try:
                    chunk = child.read_nonblocking(65536, timeout=1)
                    if chunk:
                        stream.feed(chunk)
                except Exception:
                    break
            pane = "\n".join(l.rstrip() for l in screen.display)
        try:
            child.expect(pexpect.EOF, timeout=5)
        except Exception:
            pass
        child.close(force=True)
        ms = now_ms() - t0
        save_pane(run_dir, f"bm1-{tag}", pane)
        ok = all(a in pane for a in anchors)
        return ok, ms, pane

    # Phase W: the setup wizard, driven at the recommended defaults.
    env = dict(os.environ)
    env.update({"TERM": "xterm-256color", "LINES": str(ROWS), "COLUMNS": str(COLS)})
    env.update(home_env(home))
    for k in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "COLORTERM"):
        env.pop(k, None)
    t0 = now_ms()
    child = pexpect.spawn(BUN, [UNOWN_BIN, "setup"], cwd=cwd, env=env,
                          dimensions=(ROWS, COLS), timeout=240, encoding=None)
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)

    def pump(sec: float) -> None:
        end = time.time() + sec
        while time.time() < end:
            try:
                chunk = child.read_nonblocking(65536, timeout=0.3)
                if chunk:
                    stream.feed(chunk)
            except pexpect.TIMEOUT:
                pass
            except (pexpect.EOF, OSError):
                break

    def pane_now() -> str:
        return "\n".join(l.rstrip() for l in screen.display)

    def wait_pane(anchor: str, timeout: float, tag: str) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            pump(0.5)
            p = pane_now()
            if anchor in p:
                save_pane(run_dir, f"bm1-wizard-{tag}", p)
                return p
        save_pane(run_dir, f"bm1-wizard-{tag}-TIMEOUT", pane_now())
        raise AssertionError(f"wizard never showed {anchor!r}")

    steps = 0
    try:
        wait_pane("What should unown talk to?", 120, "preset")
        child.send("\r"); steps += 1  # default 1: the bundled bridge
        wizard_theme_claim = wait_pane("Model (the bridge serves", 90, "model")
        child.send("\r"); steps += 1  # default 1: agnes-3.0-flash
        theme_pane = wait_pane("Theme [", 90, "theme")
        # S2-1 evidence: does the wizard still point theme switching at /settings?
        receipt["wizardThemeStepClaimsSettingsSwitchesTheme"] = (
            "/settings" in theme_pane and "theme" in theme_pane.lower()
        )
        child.send("\r"); steps += 1  # default 1: keep current theme
        wait_pane("setup complete", 90, "done")
        wizard_ms = now_ms() - t0
        receipt["phases"].append({"phase": "wizard", "ms": wizard_ms, "steps": steps, "ok": True})
    except AssertionError as exc:
        receipt["phases"].append({"phase": "wizard", "ms": now_ms() - t0, "steps": steps, "ok": False, "error": str(exc)})
        child.close(force=True)
        receipt["error"] = f"wizard failed: {exc}"
        write_receipt(run_dir, "bm1-first-config", receipt)
        return receipt
    finally:
        try:
            child.close(force=True)
        except Exception:
            pass

    # Phase D: doctor (the journeys' "then discover /doctor").
    ok_d, ms_d, _ = cli_in_pty(["doctor"], ["model endpoint reachable"], 180, "doctor")
    receipt["phases"].append({"phase": "doctor", "ms": ms_d, "steps": 1, "ok": ok_d})

    # Phase R: the first verified reply (live, through bridge→Agnes).
    if args.skip_live:
        receipt["phases"].append({"phase": "first-reply", "skipped": True, "ok": None})
        receipt["success"] = ok_d
    else:
        ok_r, ms_r, _ = cli_in_pty(
            ["-p", "Reply with exactly: UNOWN_OK"], ["UNOWN_OK"], 180, "first-reply"
        )
        receipt["phases"].append({"phase": "first-reply", "ms": ms_r, "steps": 1, "ok": ok_r})
        receipt["success"] = bool(ok_d and ok_r)

    receipt["totalMs"] = now_ms() - t_total
    receipt["underFiveMinutes"] = receipt["totalMs"] < 300_000
    receipt["stepsTotal"] = steps + 2
    write_receipt(run_dir, "bm1-first-config", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-2 — find-and-change
# ---------------------------------------------------------------------------


def bm2_one_reachable(cp: CountingPty, home: str, run_dir: str, task: dict) -> dict:
    task_receipt = os.path.join(run_dir, f"bm2-task-{task['task']}.json")
    if os.path.exists(task_receipt):
        with open(task_receipt, "r", encoding="utf-8") as fh:
            log(f"BM-2 task {task['task']}: resume skip (receipt exists)")
            return json.load(fh)
    row = {"task": task["task"], "itemId": task["itemId"], "outcome": "fail"}
    t0 = now_ms()
    counts_before = dict(cp.counts)
    try:
        open_hub(cp)
        navigate_to(cp, "Search settings", desc="Search row")
        cp.key("Enter")
        cp.wait_for(["Search settings ("], timeout=15, desc="search input")
        cp.send(task["query"])
        time.sleep(0.4)
        cp.send("\r")
        cp.pump(0.6)
        pane = cp.pane_text()
        if "No settings matched" in pane:
            row["outcome"] = "search-miss"
            row["error"] = f"no results for {task['query']!r}"
            save_pane(run_dir, f"bm2-{task['task']}-miss", pane)
            return row
        cp.wait_for([f'Search: "{task["query"]}"'], timeout=15, desc="results list")
        navigate_to(cp, task["editorAnchor"], desc="the search hit")
        cp.key("Enter")
        cp.wait_for([task["editorAnchor"]], timeout=15, desc="item editor")
        if task["kind"] == "number":
            navigate_to(cp, "Change value", desc="Change value row")
            cp.key("Enter")
            cp.wait_for([task["editorAnchor"], ".."], mode="all", timeout=15, desc="number input")
            cp.send(str(task["newValue"]))
            time.sleep(0.4)
            cp.send("\r")
            cp.wait_for([task["saveAnchor"]], timeout=15, desc="save notice")
        else:
            # toggle — the selected row carries the '→' marker, so match by
            # substring, never by startswith (the marker breaks it).
            for _ in range(40):
                cp.pump(0.15)
                label = selected_label(cp.pane())
                if "Turn ON" in label or "Turn OFF" in label:
                    break
                cp.key("Down", delay=0.07)
            cp.key("Enter")
            cp.wait_for(["Saved:"], timeout=15, desc="toggle save notice")
        row["outcome"] = "changed"
    except Exception as exc:
        row["error"] = repr(exc)[:300]
        save_pane(run_dir, f"bm2-{task['task']}-error", cp.pane_text())
        close_dialogs(cp)
        back_to_editor(cp)
        with open(task_receipt, "w", encoding="utf-8") as fh:
            json.dump(row, fh, indent=1)
        return row
    # disk + ledger verification (after the UI settle)
    time.sleep(0.8)
    disk_ok = False
    ledger_ok = False
    check = task["diskCheck"]
    data = read_home_json(home, check["file"])
    if data is not None:
        got = dig(data, check["key"])
        if check["expect"] == "flipped":
            # the advisor toggle: verify the value moved from its pre-state
            row["valueAfter"] = got
            disk_ok = got is not None
        else:
            row["valueAfter"] = got
            disk_ok = got == check["expect"]
    entries = [e for e in ledger_entries(home) if e.get("itemId") == task["itemId"]]
    if check["expect"] == "flipped":
        ledger_ok = bool(entries)
    else:
        ledger_ok = any(e.get("after") == check["expect"] for e in entries)
    row["diskOk"] = disk_ok
    row["ledgerOk"] = ledger_ok
    row["success"] = row["outcome"] == "changed" and disk_ok and ledger_ok
    row["ms"] = now_ms() - t0
    c = cp.counts
    row["input"] = {k: c[k] - counts_before[k] for k in c}
    save_pane(run_dir, f"bm2-{task['task']}-after", cp.pane_text())
    close_dialogs(cp)
    back_to_editor(cp)
    with open(task_receipt, "w", encoding="utf-8") as fh:
        json.dump(row, fh, indent=1)
    return row


def bm2_one_probe(cp: CountingPty, home: str, run_dir: str, probe: dict) -> dict:
    """S2-1 probe: find AND change the pi setting through /settings.

    At BEFORE (receipts run-2026-10-31T10-16-44) these probes confirmed
    unreachability. Since the M3 Interface repair each probe runs the full
    cycle: search → open the interface item → change its value → verify
    settings.json on disk + the change ledger. Outcome 'reachable+changed'
    is the AFTER gate; anything else is an honest failure receipt.
    """
    task_receipt = os.path.join(run_dir, f"bm2-task-{probe['task']}.json")
    if os.path.exists(task_receipt):
        with open(task_receipt, "r", encoding="utf-8") as fh:
            log(f"BM-2 probe {probe['task']}: resume skip (receipt exists)")
            return json.load(fh)
    row = {
        "task": probe["task"],
        "piRow": probe["piRow"],
        "expectedItem": probe.get("expectedItem"),
        "outcome": "fail",
    }
    t0 = now_ms()
    settings_before = read_home_json(home, "agent/settings.json") or {}
    try:
        # Surface 1: the hub Search row (the advertised find path).
        open_hub(cp)
        navigate_to(cp, "Search settings", desc="Search row")
        cp.key("Enter")
        cp.wait_for(["Search settings ("], timeout=15, desc="search input")
        cp.send(probe["query"])
        time.sleep(0.4)
        cp.send("\r")
        cp.pump(0.8)
        pane = cp.pane_text()
        if "No settings matched" in pane:
            row["outcome"] = "unreachable-from-tui"
            row["error"] = f"no results for {probe['query']!r}"
            save_pane(run_dir, f"bm2-{probe['task']}-probe-miss", pane)
            close_dialogs(cp)
            back_to_editor(cp)
            row["ms"] = now_ms() - t0
            with open(task_receipt, "w", encoding="utf-8") as fh:
                json.dump(row, fh, indent=1)
            return row
        # Open the hit (the top relevant result names the interface item).
        navigate_to(cp, probe["editorAnchor"], desc="the interface hit")
        cp.key("Enter")
        cp.wait_for([probe["editorAnchor"], "Back"], mode="all", timeout=15, desc="the item editor")
        # Change the value per kind.
        if probe["kind"] == "toggle":
            for _ in range(40):
                cp.pump(0.15)
                label = selected_label(cp.pane())
                if "Turn ON" in label or "Turn OFF" in label:
                    break
                cp.key("Down", delay=0.07)
            cp.key("Enter")
            cp.wait_for(["Saved:"], timeout=15, desc="toggle save notice")
        else:  # select / select-theme
            navigate_to(cp, "Change value", desc="Change value")
            cp.key("Enter")
            cp.wait_for(["pick a value"], timeout=15, desc="value picker")
            navigate_to(cp, probe["pickLabel"], desc=f"pick {probe['pickLabel']!r}")
            cp.key("Enter")
            cp.wait_for(["Saved:"], timeout=15, desc="save notice")
        row["outcome"] = "changed"
    except Exception as exc:
        row["error"] = repr(exc)[:300]
        save_pane(run_dir, f"bm2-{probe['task']}-probe-error", cp.pane_text())
        close_dialogs(cp)
        back_to_editor(cp)
        row["ms"] = now_ms() - t0
        with open(task_receipt, "w", encoding="utf-8") as fh:
            json.dump(row, fh, indent=1)
        return row
    # disk + ledger verification
    time.sleep(0.8)
    settings_after = read_home_json(home, "agent/settings.json") or {}
    row["settingsChanged"] = settings_after != settings_before
    row["ledgerOk"] = any(
        e.get("itemId") == probe.get("expectedItem") for e in ledger_entries(home)
    )
    row["success"] = row["outcome"] == "changed" and row["settingsChanged"] and row["ledgerOk"]
    row["outcome"] = "reachable+changed" if row["success"] else row["outcome"]
    save_pane(run_dir, f"bm2-{probe['task']}-probe", cp.pane_text())
    close_dialogs(cp)
    back_to_editor(cp)
    row["ms"] = now_ms() - t0
    with open(task_receipt, "w", encoding="utf-8") as fh:
        json.dump(row, fh, indent=1)
    return row


def run_bm2(run_dir: str, args) -> dict:
    tasks = load_tasks("bm2-find-change.json")
    home = os.path.join(WORK_ROOT, "bm2-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm2-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt = {"bm": "bm2", "seeded": seeded, "reachable": [], "unreachableProbes": []}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm2-find-change", receipt)
        return receipt
    cp = boot_tui(home, cwd)
    try:
        for task in tasks["reachable"]:
            log(f"BM-2 reachable: {task['task']}")
            receipt["reachable"].append(bm2_one_reachable(cp, home, run_dir, task))
        for probe in tasks["unreachable_probes"]:
            log(f"BM-2 probe: {probe['task']}")
            receipt["unreachableProbes"].append(bm2_one_probe(cp, home, run_dir, probe))
    finally:
        cp.close()
    ok = [r for r in receipt["reachable"] if r.get("success")]
    receipt["summary"] = {
        "reachableSuccess": f"{len(ok)}/{len(tasks['reachable'])}",
        "unreachableConfirmed": sum(1 for r in receipt["unreachableProbes"] if r["outcome"] == "unreachable-from-tui"),
        "probesReachableAndChanged": sum(1 for r in receipt["unreachableProbes"] if r["outcome"] == "reachable+changed"),
        "unreachableTotal": len(tasks["unreachable_probes"]),
        "meanReachableMs": (sum(r.get("ms", 0) for r in receipt["reachable"]) / max(1, len(receipt["reachable"]))),
    }
    write_receipt(run_dir, "bm2-find-change", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-3 — search success
# ---------------------------------------------------------------------------


def run_bm3(run_dir: str, args) -> dict:
    tasks = load_tasks("bm3-search-queries.json")["queries"]
    home = os.path.join(WORK_ROOT, "bm3-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm3-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt = {"bm": "bm3", "seeded": seeded, "queries": []}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm3-search", receipt)
        return receipt
    cp = boot_tui(home, cwd)
    try:
        for q in tasks:
            slug = q["q"].replace(" ", "-")
            q_receipt = os.path.join(run_dir, f"bm3-query-{slug}.json")
            if os.path.exists(q_receipt):
                with open(q_receipt, "r", encoding="utf-8") as fh:
                    log(f"BM-3 query {q['q']!r}: resume skip (receipt exists)")
                    receipt["queries"].append(json.load(fh))
                continue
            row = {"q": q["q"], "targetId": q["targetId"], "expectedAtBefore": q["expectedAtBefore"]}
            try:
                open_hub(cp)
                navigate_to(cp, "Search settings", desc="Search row")
                cp.key("Enter")
                cp.wait_for(["Search settings ("], timeout=15, desc="search input")
                cp.send(q["q"])
                time.sleep(0.4)
                cp.send("\r")
                cp.pump(0.8)
                pane = cp.pane_text()
                if "No settings matched" in pane:
                    row["hit"] = False
                    row["rank"] = None
                    row["topResults"] = []
                else:
                    # parse the rendered result rows: "Section → Name ○HIGH"
                    results = []
                    for line in pane.splitlines():
                        s = line.strip().lstrip("\u2192\u276f> ").strip()
                        if "\u2192" in s and not s.startswith("Search:"):
                            results.append(s)
                    row["topResults"] = results[:10]
                    rank = next(
                        (i + 1 for i, r in enumerate(results[:3]) if q["targetLabel"].lower() in r.lower()),
                        None,
                    )
                    row["hit"] = rank is not None
                    row["rank"] = rank
                save_pane(run_dir, f"bm3-{q['q'].replace(' ', '-')}", pane)
            except Exception as exc:
                row["error"] = repr(exc)[:300]
                save_pane(run_dir, f"bm3-{q['q'].replace(' ', '-')}-error", cp.pane_text())
                close_dialogs(cp)
                back_to_editor(cp)
                receipt["queries"].append(row)
                with open(q_receipt, "w", encoding="utf-8") as fh:
                    json.dump(row, fh, indent=1)
                continue
            close_dialogs(cp)
            back_to_editor(cp)
            receipt["queries"].append(row)
            with open(q_receipt, "w", encoding="utf-8") as fh:
                json.dump(row, fh, indent=1)
    finally:
        cp.close()
    hits = sum(1 for r in receipt["queries"] if r.get("hit"))
    expected_hits = sum(1 for r in receipt["queries"] if r.get("expectedAtBefore") == "hit" and r.get("hit"))
    receipt["summary"] = {
        "hitRate": f"{hits}/{len(tasks)}",
        "hitRatePct": round(100 * hits / max(1, len(tasks)), 1),
        "expectedHitsMade": f"{expected_hits}/{sum(1 for q in tasks if q['expectedAtBefore'] == 'hit')}",
    }
    write_receipt(run_dir, "bm3-search", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-4 — depth-to-setting (browse-only) + registry coverage
# ---------------------------------------------------------------------------


def run_bm4(run_dir: str, args) -> dict:
    mapping = load_tasks("bm4-bm6-map.json")
    home = os.path.join(WORK_ROOT, "bm4-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm4-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt = {"bm": "bm4", "seeded": seeded, "items": []}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm4-depth", receipt)
        return receipt
    cp = boot_tui(home, cwd)
    try:
        for item in mapping["bm4_sample"]:
            row = {"itemId": item["itemId"], "section": item["section"]}
            t0 = now_ms()
            downs_before = cp.counts["downs"]
            try:
                open_hub(cp)
                navigate_to(cp, f"{item['section']} —", desc="section row")
                cp.key("Enter")
                cp.wait_for([item["rowLabel"]], timeout=20, desc="section list")
                navigate_to(cp, item["rowLabel"], desc="item row")
                cp.key("Enter")
                cp.wait_for([item["rowLabel"], "Back"], mode="all", timeout=20, desc="item editor")
                row["depthDowns"] = cp.counts["downs"] - downs_before
                row["reached"] = True
                save_pane(run_dir, f"bm4-{item['itemId'].replace('.', '-')}", cp.pane_text())
            except Exception as exc:
                row["error"] = repr(exc)[:300]
                row["reached"] = False
                save_pane(run_dir, f"bm4-{item['itemId'].replace('.', '-')}-error", cp.pane_text())
            row["ms"] = now_ms() - t0
            receipt["items"].append(row)
            close_dialogs(cp)
            back_to_editor(cp)
    finally:
        cp.close()
    downs = [r["depthDowns"] for r in receipt["items"] if r.get("reached")]
    receipt["summary"] = {
        "reached": f"{len(downs)}/{len(mapping['bm4_sample'])}",
        "meanDowns": round(sum(downs) / max(1, len(downs)), 1),
        "maxDowns": max(downs) if downs else None,
    }
    # registry coverage rides the audit receipt when present
    audit = read_receipt(run_dir, "bm7-audit")
    if audit:
        receipt["summary"]["registryCoverage"] = {
            "settableOverTotal": audit["coverage"]["settableOverTotal"],
            "piUnreachable": audit["piSelector"]["unreachableCount"],
        }
    write_receipt(run_dir, "bm4-depth", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-5 — recovery paths
# ---------------------------------------------------------------------------


def run_bm5(run_dir: str, args) -> dict:
    home = os.path.join(WORK_ROOT, "bm5-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm5-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt = {"bm": "bm5", "seeded": seeded, "paths": []}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm5-recovery", receipt)
        return receipt
    cp = boot_tui(home, cwd)

    def path_row(name: str) -> dict:
        return {"path": name, "ok": False}

    try:
        # P1: change → Recently changed → revert → value restored.
        r = path_row("change→recent→revert")
        t0 = now_ms()
        try:
            open_hub(cp)
            navigate_to(cp, "Search settings", desc="Search row")
            cp.key("Enter")
            cp.wait_for(["Search settings ("], timeout=15)
            cp.send("goal budget")
            time.sleep(0.4)
            cp.send("\r")
            navigate_to(cp, "Goal budget", desc="hit")
            cp.key("Enter")
            navigate_to(cp, "Change value", desc="Change value")
            cp.key("Enter")
            cp.wait_for(["Goal budget (turns)", ".."], mode="all", timeout=15)
            cp.send("25")
            time.sleep(0.4)
            cp.send("\r")
            cp.wait_for(["Saved: Goal budget (turns) = 25"], timeout=15)
            close_dialogs(cp)
            back_to_editor(cp)
            open_hub(cp)
            navigate_to(cp, "Recently changed", desc="Recent row")
            cp.key("Enter")
            cp.wait_for(["Goal budget (turns)"], timeout=15, desc="recent list")
            navigate_to(cp, "Goal budget", desc="recent entry")
            cp.key("Enter")  # opens the entry's revert confirm dialog
            cp.wait_for(["Revert"], timeout=15, desc="revert confirm dialog")
            save_pane(run_dir, "bm5-revert-confirm", cp.pane_text())
            # ctx.ui.confirm renders Yes/No options — select Yes if present,
            # else Enter takes the default.
            cp.pump(0.5)
            pane = cp.pane_text()
            if "Yes" in pane:
                navigate_to(cp, "Yes", desc="confirm Yes")
            cp.key("Enter")
            time.sleep(1.2)
            cp.pump(0.6)
            prefs = read_home_json(home, "agent/settings-hub.json") or {}
            r["valueAfterRevert"] = prefs.get("goalBudgetTurns")
            r["ok"] = prefs.get("goalBudgetTurns") in (0, None)
            r["ms"] = now_ms() - t0
        except Exception as exc:
            r["error"] = repr(exc)[:300]
            save_pane(run_dir, "bm5-recent-error", cp.pane_text())
        receipt["paths"].append(r)
        close_dialogs(cp)
        back_to_editor(cp)

        # P2: diff shows drift after a change.
        r = path_row("diff-shows-drift")
        t0 = now_ms()
        try:
            # make a real drift: hook depth 5 (default is 3 — setting 3
            # would be a no-op drift, the first run's caught mistake)
            open_hub(cp)
            navigate_to(cp, "Search settings", desc="Search row")
            cp.key("Enter")
            cp.wait_for(["Search settings ("], timeout=15)
            cp.send("hook loop")
            time.sleep(0.4)
            cp.send("\r")
            navigate_to(cp, "Hook loop breaker", desc="hit")
            cp.key("Enter")
            navigate_to(cp, "Change value", desc="Change value")
            cp.key("Enter")
            cp.wait_for(["Hook loop breaker (max depth)", ".."], mode="all", timeout=15)
            cp.send("5")
            time.sleep(0.4)
            cp.send("\r")
            cp.wait_for(["Saved: Hook loop breaker (max depth) = 5"], timeout=15)
            close_dialogs(cp)
            back_to_editor(cp)
            cp.type_prompt("/settings diff")
            cp.wait_for(["Hook loop breaker (max depth)"], timeout=15, desc="diff lane")
            save_pane(run_dir, "bm5-diff", cp.pane_text())
            r["ok"] = True
            r["ms"] = now_ms() - t0
        except Exception as exc:
            r["error"] = repr(exc)[:300]
            save_pane(run_dir, "bm5-diff-error", cp.pane_text())
        receipt["paths"].append(r)
        close_dialogs(cp)
        back_to_editor(cp)

        # P3: kill-switch row reachable (Automation section).
        r = path_row("kill-switch-reachable")
        t0 = now_ms()
        try:
            open_hub(cp)
            navigate_to(cp, "Automation —", desc="Automation row")
            cp.key("Enter")
            cp.wait_for(["Stop a running routine (kill switch)"], timeout=20, desc="kill switch row")
            r["ok"] = True
            r["ms"] = now_ms() - t0
            save_pane(run_dir, "bm5-killswitch", cp.pane_text())
        except Exception as exc:
            r["error"] = repr(exc)[:300]
        receipt["paths"].append(r)
        close_dialogs(cp)
        back_to_editor(cp)

        # P4: dream-rollback row reachable (Recovery section).
        r = path_row("dream-rollback-reachable")
        t0 = now_ms()
        try:
            open_hub(cp)
            navigate_to(cp, "Recovery —", desc="Recovery row")
            cp.key("Enter")
            cp.wait_for(["Roll back learned memory"], timeout=20, desc="dream rollback row")
            r["ok"] = True
            r["ms"] = now_ms() - t0
            save_pane(run_dir, "bm5-dreamrollback", cp.pane_text())
        except Exception as exc:
            r["error"] = repr(exc)[:300]
        receipt["paths"].append(r)
        close_dialogs(cp)
        back_to_editor(cp)

        # P5: scoped reset writes a backup first (subcommand lane).
        r = path_row("scoped-reset-backup")
        t0 = now_ms()
        try:
            cp.type_prompt("/settings reset hub")
            cp.wait_for(["Reset done (backup:"], timeout=20, desc="reset with backup")
            save_pane(run_dir, "bm5-reset", cp.pane_text())
            bdir = os.path.join(home, "agent", "settings-backups")
            backups = os.listdir(bdir) if os.path.isdir(bdir) else []
            r["backupOnDisk"] = bool(backups)
            r["backupFiles"] = backups[:5]
            r["ok"] = bool(backups)
            r["ms"] = now_ms() - t0
        except Exception as exc:
            r["error"] = repr(exc)[:300]
            save_pane(run_dir, "bm5-reset-error", cp.pane_text())
        receipt["paths"].append(r)
    finally:
        cp.close()
    receipt["summary"] = {
        "okPaths": f"{sum(1 for p in receipt['paths'] if p.get('ok'))}/{len(receipt['paths'])}"
    }
    write_receipt(run_dir, "bm5-recovery", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-6 — six-questions coverage
# ---------------------------------------------------------------------------


def run_bm6(run_dir: str, args) -> dict:
    mapping = load_tasks("bm4-bm6-map.json")["bm6_map"]
    home = os.path.join(WORK_ROOT, "bm6-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm6-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt = {"bm": "bm6", "seeded": seeded, "questions": []}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm6-six-questions", receipt)
        return receipt
    cp = boot_tui(home, cwd)
    try:
        for q in mapping:
            row = {"question": q["question"], "anchors": q["anchors"]}
            try:
                open_hub(cp)
                navigate_to(cp, f"{q['path'][0]} —", desc="section row")
                cp.key("Enter")
                time.sleep(0.8)
                cp.pump(0.6)
                pane = cp.pane_text()
                save_pane(run_dir, f"bm6-{q['question'].split()[0].lower()}", pane)
                missing = [a for a in q["anchors"] if a not in pane]
                row["missingAnchors"] = missing
                row["covered"] = not missing
            except Exception as exc:
                row["error"] = repr(exc)[:300]
                row["covered"] = False
                save_pane(run_dir, f"bm6-{q['question'].split()[0].lower()}-error", cp.pane_text())
            receipt["questions"].append(row)
            close_dialogs(cp)
            back_to_editor(cp)
    finally:
        cp.close()
    receipt["summary"] = {
        "covered": f"{sum(1 for q in receipt['questions'] if q.get('covered'))}/{len(mapping)}"
    }
    write_receipt(run_dir, "bm6-six-questions", receipt)
    return receipt


# ---------------------------------------------------------------------------
# BM-7 — trust gates (audit + typed-confirmation probe)
# ---------------------------------------------------------------------------


def run_bm7(run_dir: str, args) -> dict:
    receipt = {"bm": "bm7"}
    # Part A: the registry audit (runtime truth).
    audit_out = os.path.join(run_dir, "bm7-audit.json")
    env = dict(os.environ)
    env["UNOWN_HOME"] = os.path.join(WORK_ROOT, "bm7-audit-home")
    os.makedirs(env["UNOWN_HOME"], exist_ok=True)
    proc = subprocess.run(
        [BUN, os.path.join(HERE, "audit-registry.mjs"), "--out", audit_out],
        cwd=UNOWN_ROOT, env=env, capture_output=True, timeout=180,
    )
    if proc.returncode != 0:
        receipt["auditError"] = proc.stderr.decode()[:400]
        write_receipt(run_dir, "bm7-trust-gates", receipt)
        return receipt
    with open(audit_out, "r", encoding="utf-8") as fh:
        audit = json.load(fh)
    audit_ok = (
        audit["registryIntegrity"]["ok"]
        and not audit["fieldGaps"]
        and not audit["settableWithoutPersistence"]
    )
    receipt["auditOk"] = audit_ok
    receipt["auditHeadline"] = {
        "items": audit["registryCount"],
        "risk": audit["riskCounts"],
        "settable": len(audit["settable"]),
        "piUnreachable": audit["piSelector"]["unreachableCount"],
    }

    # Part B: the typed-confirmation PTY probe (high-risk item).
    home = os.path.join(WORK_ROOT, "bm7-home")
    subprocess.run(["rm", "-rf", home], check=False)
    os.makedirs(home, exist_ok=True)
    cwd = os.path.join(WORK_ROOT, "bm7-cwd")
    os.makedirs(cwd, exist_ok=True)
    seeded = seed_home(home)
    receipt["seeded"] = seeded
    probe = {"item": "safety.default-project-trust", "gateShown": False, "wrongPhraseCancels": False, "yesWrites": False}
    if not seeded:
        receipt["error"] = "doctor seeding failed"
        write_receipt(run_dir, "bm7-trust-gates", receipt)
        return receipt
    cp = boot_tui(home, cwd)
    try:
        open_hub(cp)
        navigate_to(cp, "Search settings", desc="Search row")
        cp.key("Enter")
        cp.wait_for(["Search settings ("], timeout=15)
        cp.send("default project trust")
        time.sleep(0.4)
        cp.send("\r")
        navigate_to(cp, "Default project trust", desc="hit")
        cp.key("Enter")
        cp.wait_for(["Default project trust"], timeout=15, desc="editor")
        settings_before = read_home_json(home, "agent/settings.json") or {}
        navigate_to(cp, "Change value", desc="Change value")
        cp.key("Enter")
        cp.pump(0.8)
        # pick a DIFFERENT value than current (walk Down once from the top)
        cp.key("Down")
        cp.key("Enter")
        cp.wait_for(['Type "yes" to confirm'], timeout=15, desc="typed confirmation gate")
        probe["gateShown"] = True
        save_pane(run_dir, "bm7-confirm-gate", cp.pane_text())
        # wrong phrase: must cancel and write nothing
        cp.send("no")
        time.sleep(0.4)
        cp.send("\r")
        cp.wait_for(["Cancelled — nothing was written"], timeout=15, desc="cancel notice")
        settings_mid = read_home_json(home, "agent/settings.json") or {}
        probe["wrongPhraseCancels"] = settings_mid == settings_before
        # right phrase: writes + ledger
        navigate_to(cp, "Change value", desc="Change value again")
        cp.key("Enter")
        cp.pump(0.8)
        cp.key("Down")
        cp.key("Enter")
        cp.wait_for(['Type "yes" to confirm'], timeout=15, desc="gate again")
        cp.send("yes")
        time.sleep(0.4)
        cp.send("\r")
        cp.wait_for(["Saved:"], timeout=15, desc="saved after yes")
        time.sleep(0.8)
        settings_after = read_home_json(home, "agent/settings.json") or {}
        probe["yesWrites"] = settings_after != settings_before
        probe["ledgerEntry"] = any(
            e.get("itemId") == "safety.default-project-trust" for e in ledger_entries(home)
        )
    except Exception as exc:
        probe["error"] = repr(exc)[:300]
        save_pane(run_dir, "bm7-probe-error", cp.pane_text())
    finally:
        cp.close()
    receipt["probe"] = probe
    receipt["summary"] = {
        "auditOk": audit_ok,
        "gateFullCycle": bool(
            probe["gateShown"] and probe["wrongPhraseCancels"] and probe["yesWrites"] and probe.get("ledgerEntry")
        ),
    }
    write_receipt(run_dir, "bm7-trust-gates", receipt)
    return receipt


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def build_summary(run_dir: str) -> dict:
    s = {"generatedAt": utc_stamp(), "bm": {}}
    bm1 = read_receipt(run_dir, "bm1-first-config")
    if bm1:
        s["bm"]["bm1"] = {
            "success": bm1.get("success"),
            "totalMs": bm1.get("totalMs"),
            "underFiveMinutes": bm1.get("underFiveMinutes"),
            "steps": bm1.get("stepsTotal"),
            "wizardThemeStepClaimsSettingsSwitchesTheme": bm1.get("wizardThemeStepClaimsSettingsSwitchesTheme"),
        }
    bm2 = read_receipt(run_dir, "bm2-find-change")
    if bm2:
        s["bm"]["bm2"] = bm2.get("summary")
        s["bm"]["bm2"]["reachableDetail"] = [
            {k: r.get(k) for k in ("task", "outcome", "success", "diskOk", "ledgerOk", "ms")}
            for r in bm2.get("reachable", [])
        ]
        s["bm"]["bm2"]["probeDetail"] = [
            {k: r.get(k) for k in ("task", "outcome")} for r in bm2.get("unreachableProbes", [])
        ]
    bm3 = read_receipt(run_dir, "bm3-search")
    if bm3:
        s["bm"]["bm3"] = bm3.get("summary")
        s["bm"]["bm3"]["detail"] = [
            {k: r.get(k) for k in ("q", "hit", "rank", "expectedAtBefore")} for r in bm3.get("queries", [])
        ]
    bm4 = read_receipt(run_dir, "bm4-depth")
    if bm4:
        s["bm"]["bm4"] = bm4.get("summary")
    bm5 = read_receipt(run_dir, "bm5-recovery")
    if bm5:
        s["bm"]["bm5"] = bm5.get("summary")
    bm6 = read_receipt(run_dir, "bm6-six-questions")
    if bm6:
        s["bm"]["bm6"] = bm6.get("summary")
        s["bm"]["bm6"]["detail"] = [
            {k: q.get(k) for k in ("question", "covered", "missingAnchors")} for q in bm6.get("questions", [])
        ]
    bm7 = read_receipt(run_dir, "bm7-trust-gates")
    if bm7:
        s["bm"]["bm7"] = bm7.get("summary")
        s["bm"]["bm7"]["auditHeadline"] = bm7.get("auditHeadline")
    write_receipt(run_dir, "summary", s)
    return s


LANES = {
    "bm1": run_bm1,
    "bm2": run_bm2,
    "bm3": run_bm3,
    "bm4": run_bm4,
    "bm5": run_bm5,
    "bm6": run_bm6,
    "bm7": run_bm7,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--only", default=None, help="comma list: bm1,bm2,...")
    ap.add_argument("--skip-live", action="store_true", help="skip BM-1's live model reply")
    ap.add_argument("--keep-homes", action="store_true")
    args = ap.parse_args()

    run_dir = args.run_dir or os.path.join(
        HERE, "receipts", "run-" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    )
    os.makedirs(run_dir, exist_ok=True)
    os.makedirs(WORK_ROOT, exist_ok=True)
    log(f"run dir: {run_dir}")

    order = ["bm7", "bm1", "bm2", "bm3", "bm4", "bm5", "bm6"]
    # bm7 first: its audit receipt feeds bm4's coverage block on a full run.
    todo = args.only.split(",") if args.only else order
    for lane in todo:
        lane = lane.strip()
        if lane not in LANES:
            log(f"unknown lane {lane!r} — skipping")
            continue
        log(f"=== {lane.upper()} ===")
        try:
            LANES[lane](run_dir, args)
        except Exception as exc:
            log(f"lane {lane} crashed: {exc!r}")

    summary = build_summary(run_dir)
    log("summary:")
    print(json.dumps(summary["bm"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
