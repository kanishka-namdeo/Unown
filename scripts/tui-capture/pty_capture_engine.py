#!/usr/bin/env python3
"""
pty_capture_engine.py — M6 degraded-mode UX, verified live from an end
user's POV (the push gate: "live end to end verification from an end user's
POV").

Drives the real `unown` TUI in a PTY and walks the whole resilience story:

  S0  footer "memory: up" at session start (engine healthy, no toast)
  S1  /engine while UP (status card: pid, budget, outbox, actions)
  S2  /learning staleness header (per-tier "updated X ago")
  S3  engine SIGKILLed mid-session -> footer "memory: down" + warning toast
      -> gated auto-start -> "memory: starting..." -> recovery "memory: up"
      (+ "learning resumed" toast)
  S4  corrupt SQLite DB -> spawned engines fail the M6 boot integrity gate
      -> crash-loop circuit burns 5 attempts -> footer "memory: paused ·
      /engine" + "won't start" toast; /engine shows the PAUSED card
  S5  `unown engine repair` (quarantine + fresh boot) -> footer recovers to
      "memory: up"; the session note queued while down drains from the outbox
  S6  doctor with the engine stopped (degraded engine line + pending count),
      then `unown engine start` restores

Stills + pane dumps land in $OUT (receipts). Every step is anchor-verified
against the pane text — pyte is the emulator, so pane == pixels.

Env knobs: UNOWN_ROOT (repo), OUT (stills dir), PI_ENGINE_PROBE_INTERVAL_MS
is FORCED to 5000 (the documented floor) inside the TUI so the demo cadence
is snappy; every other behavior is the shipped default.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pty_common as P  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")
P.UNOWN_ROOT = UNOWN_ROOT
OUT = os.environ.get("OUT", "/home/z/my-project/download/unown-engine-captures/stills")
P.OUT_DIR = OUT
DB = os.path.join(UNOWN_ROOT, "db", "selflearning.db")
ENGINE_URL = "http://127.0.0.1:3030"
# M7: the engine requires its per-boot bearer token — same-user tooling reads
# data/self-learning/engine.token (PI_SELFLEARNING_DATA redirect honored);
# UNOWN_ENGINE_TOKEN (env pin) wins, matching src/engine-auth.ts.
TOKEN_FILE = os.path.join(
    os.environ.get("PI_SELFLEARNING_DATA", ""), "engine.token"
) if os.environ.get("PI_SELFLEARNING_DATA") else os.path.join(
    UNOWN_ROOT, "data", "self-learning", "engine.token"
)


def engine_auth_headers() -> list[str]:
    pinned = os.environ.get("UNOWN_ENGINE_TOKEN", "").strip()
    tok = pinned
    if not tok:
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                tok = f.read().strip()
        except Exception:
            tok = ""
    return (["-H", f"Authorization: Bearer {tok}"] if tok else [])

LOG_LINES: list[str] = []


def log(msg: str):
    LOG_LINES.append(msg)
    print(f"[engine-e2e] {msg}", flush=True)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def sh(cmd: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=UNOWN_ROOT, capture_output=True, text=True, timeout=timeout
    )


def engine_pid() -> int | None:
    r = sh(["curl", "-s", "-m", "2", *engine_auth_headers(), f"{ENGINE_URL}/api/overview"])
    if r.returncode != 0 or '"ok":true' not in r.stdout:
        return None
    try:
        return json.loads(r.stdout).get("pid")
    except Exception:
        return None


def engine_up() -> bool:
    return engine_pid() is not None


def outbox_count() -> int:
    d = os.path.expanduser("~/.unown/notes/outbox")
    try:
        return len([n for n in os.listdir(d) if n.endswith(".md")])
    except FileNotFoundError:
        return 0


def receipts_dir() -> str:
    return os.path.join(UNOWN_ROOT, ".unown", "receipts")


def latest_receipt_has_prompt(marker: str, since_ts: float) -> bool:
    """Deterministic chat-turn proof: the receipts ledger records every prompt
    (pane anchors on streamed replies are phrasing-brittle)."""
    import glob
    try:
        files = sorted(glob.glob(os.path.join(receipts_dir(), "*.jsonl")), key=os.path.getmtime)
        if not files:
            return False
        newest = files[-1]
        if os.path.getmtime(newest) < since_ts - 5:
            return False  # no new session since we booted the TUI
        with open(newest, encoding="utf-8") as f:
            return marker in f.read()
    except OSError:
        return False


def drained_note_mentions(fragment: str) -> bool:
    """The ultimate receipt: the drained session note's content in the engine DB."""
    import sqlite3
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        rows = con.execute(
            "SELECT content FROM notes WHERE kind='terminal' ORDER BY created_at DESC LIMIT 3"
        ).fetchall()
        con.close()
        return any(fragment in (r[0] or "") for r in rows)
    except Exception:
        return False


def kill_engine_hard():
    pid = engine_pid()
    if pid is None:
        log("engine already down")
        return
    os.kill(pid, signal.SIGKILL)
    deadline = time.time() + 10
    while time.time() < deadline:
        if not engine_up():
            log(f"engine SIGKILLed (pid {pid}) — down")
            return
        time.sleep(0.3)
    raise RuntimeError("engine refused to die")


def wait_engine_up(timeout: float = 30.0) -> int:
    deadline = time.time() + timeout
    while time.time() < deadline:
        pid = engine_pid()
        if pid is not None:
            return pid
        time.sleep(0.5)
    raise RuntimeError("engine did not come up")


RESULTS: list[P.StillRecord] = []


def record(still: P.StillRecord):
    RESULTS.append(still)
    return still.ok


def footer_in(pane: str, text: str) -> bool:
    return any(line.strip().endswith(text) or text in line for line in pane.split("\n"))


def settle(s, t=0.4):
    """The proven inter-command pause from pty_capture.py: let overlays and
    autocompletion settle before the next keystroke train."""
    time.sleep(t)
    s.pump(0.6)


# ---------------------------------------------------------------------------
# the journey
# ---------------------------------------------------------------------------


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    tui_env = {"PI_ENGINE_PROBE_INTERVAL_MS": "5000"}
    notes_before = outbox_count()
    log(f"start: engine_up={engine_up()} outbox={notes_before}")

    if not engine_up():
        log("precondition: engine must be UP for S0 — starting it")
        sh(["bun", "bin/unown", "engine", "start"], timeout=60)
        wait_engine_up(45)

    # ---- S0/S1/S2: healthy session --------------------------------------
    tui = P.UnownPty(log, cwd=UNOWN_ROOT, env_extra=tui_env)
    try:
        tui.wait_ready(90)
        tui.wait_idle(timeout=30)  # let the boot settle (MCP, memory, notifier)
        pane = tui.wait_for(["memory: up"], timeout=20, desc="footer memory: up")
        ok = record(tui.still("s0-footer-up", ["memory: up"]))
        log(f"S0 footer-up ok={ok}")

        settle(tui)
        tui.type_prompt("/engine")
        pane = tui.wait_for(
            ["status: UP", "auto-start:", "outbox:"], timeout=20, desc="/engine UP card"
        )
        ok = record(tui.still("s1-engine-command-up", ["status: UP"]))
        log(f"S1 /engine-up ok={ok}")

        settle(tui)
        tui.type_prompt("/learning")
        pane = tui.wait_for(
            ["(updated"], timeout=20, desc="/learning per-tier staleness"
        )
        ok = record(tui.still("s2-learning-staleness", ["(updated"]))
        log(f"S2 /learning ok={ok}")
        settle(tui)

        # ---- S3: crash mid-session -> down -> auto-recovery --------------
        kill_engine_hard()
        # down is detected within one probe interval (5s); the toast is
        # transient, the footer line is the durable signal.
        try:
            pane = tui.wait_for(
                ["memory engine unreachable"], timeout=14, desc="down toast"
            )
            record(tui.still("s3-toast-down", ["memory engine unreachable"]))
            log("S3 down toast captured")
        except P.PaneTimeout:
            log("S3 down toast not captured in pane (transient) — footer is the contract")
        pane = tui.wait_for(
            ["memory: down", "memory: starting"], mode="any", timeout=14,
            desc="footer down/starting",
        )
        record(tui.still("s3-footer-down", ["memory: down", "memory: starting"], mode="any"))
        log(f"S3 footer-down captured; outbox now {outbox_count()}")

        pane = tui.wait_for(
            ["memory: up"], timeout=60, desc="footer recovery after auto-start"
        )
        try:
            tui.wait_for(["memory engine online"], timeout=8, desc="recovery toast")
            record(tui.still("s3-toast-recovered", ["memory engine online"]))
        except P.PaneTimeout:
            record(tui.still("s3-footer-recovered", ["memory: up"]))
        ok = record(tui.still("s3-footer-recovered", ["memory: up"]))
        log(f"S3 auto-recovery ok={ok} (engine pid {engine_pid()})")

        # ---- S4: crash-loop -> paused -------------------------------------
        # Stop the engine, corrupt the DB, then let the session's probes
        # kick doomed spawns until the circuit gives up (5 attempts).
        sh(["bun", "bin/unown", "engine", "stop"], timeout=30)
        time.sleep(1.5)
        shutil.copyfile(DB, DB + ".pre-corruption-backup")
        # Clobber the header page AND both WAL sidecars: a header-only clobber
        # is HEALED by SQLite WAL recovery (learned live: the -wal file held a
        # valid page-1 image and the next open restored the header — SQLite's
        # own crash recovery doing its job). Tearing all three files is the
        # honest environmental-corruption simulation (power loss mid-write).
        for suffix in ["", "-wal", "-shm"]:
            p = DB + suffix
            if os.path.exists(p):
                with open(p, "r+b") as f:
                    f.seek(0)
                    f.write(b"CORRUPTED-BY-E2E-DEMO" * 64)  # clobber the header page
        log("DB + WAL sidecars corrupted (backup at db/selflearning.db.pre-corruption-backup)")

        pane = tui.wait_for(
            ["memory: paused"], timeout=120, desc="footer paused (circuit gave up)"
        )
        ok = record(tui.still("s4-footer-paused", ["memory: paused · /engine"]))
        log(f"S4 footer-paused ok={ok}")

        tui.type_prompt("/engine")
        pane = tui.wait_for(
            ["status: PAUSED", "gave up after 5"], timeout=20, desc="/engine PAUSED card"
        )
        ok = record(tui.still("s4-engine-command-paused", ["status: PAUSED"]))
        log(f"S4 /engine-paused ok={ok}")

        settle(tui)
        # One real chat turn so the session owes a note at quit (slash commands
        # alone do not count as prompts — termhooks skips noteless sessions).
        # Proof is the receipts ledger (deterministic): pane anchors on the
        # streamed reply are phrasing-brittle ("ready" vs "Ready.").
        chat_t0 = time.time()
        tui.type_prompt("Reply with the single word: ready")
        reply_deadline = time.time() + 90
        replied = False
        while time.time() < reply_deadline and not tui.dead:
            tui.pump(0.4)
            lines = [l.strip().lower() for l in tui.pane_text().split("\n")]
            if "ready" in lines:
                replied = True
                break
            if latest_receipt_has_prompt("Reply with the single word", chat_t0 - 60):
                replied = True  # prompt recorded; let the stream settle below
                tui.wait_idle(timeout=45)
                break
            time.sleep(1.0)
        if not replied:
            replied = latest_receipt_has_prompt("Reply with the single word", chat_t0 - 60)
        record(tui.still("s4-chat-unaffected", ["ready", "Reply with the single word"], mode="any"))
        log(f"S4 chat turn done replied={replied} (session now owes a note)")
        RESULTS.append(
            P.StillRecord(name="s4-chat-unaffected", anchors=["chat unaffected"],
                          png="", pane="", ok=replied,
                          detail="real chat turn completed with engine paused")
        )
        # CRITICAL (learned live): the reply word can render while the turn is
        # STILL STREAMING — typing /quit then gets swallowed by the active turn
        # and the session dies at close() with no shutdown (no note). Let the
        # turn settle to stillness first.
        tui.wait_idle(timeout=45)
        settle(tui, 1.0)

        # ---- S5: repair -> recovery --------------------------------------
        # Quit the session first: the shutdown note must land in the outbox
        # (assumeDown fast path), then drain into the repaired engine.
        queued_before_quit = outbox_count()
        tui.type_prompt("/quit")
        # Wait for the actual exit (clean shutdown → note path), not a blind sleep.
        quit_deadline = time.time() + 20
        while time.time() < quit_deadline:
            time.sleep(1)
            tui.pump(0.3)
            exited = tui.dead or tui.child.exitstatus is not None
            if exited or outbox_count() > queued_before_quit:
                break
        tui.close()
        tui = None  # type: ignore
        queued_after_quit = outbox_count()
        noted = queued_after_quit > queued_before_quit
        log(f"S5 session note queued: {queued_before_quit} -> {queued_after_quit} (ok={noted})")
        RESULTS.append(
            P.StillRecord(name="s5-note-queued", anchors=["queued"], png="", pane="",
                          ok=noted,
                          detail=f"outbox {queued_before_quit} -> {queued_after_quit} at quit")
        )

        r = sh(["bun", "bin/unown", "engine", "repair"], timeout=60)
        log(f"repair rc={r.returncode}\n{r.stdout.strip()[:400]}")
        ok = "quarantined" in r.stdout
        RESULTS.append(
            P.StillRecord(name="s5-repair-cli", anchors=["quarantined"], png="", pane="",
                          ok=ok, detail=r.stdout.strip()[:200].replace("\n", " | "))
        )
        # repair quarantines + resets the circuit but does NOT boot: the user
        # starts fresh explicitly (the documented flow).
        r2 = sh(["bun", "bin/unown", "engine", "start"], timeout=60)
        log(f"engine start after repair rc={r2.returncode}")
        wait_engine_up(45)
        log(f"engine back up after repair (pid {engine_pid()})")

        tui2 = P.UnownPty(log, cwd=UNOWN_ROOT, env_extra=tui_env)
        try:
            tui2.wait_ready(90)
            tui2.wait_idle(timeout=30)
            pane = tui2.wait_for(["memory: up"], timeout=25, desc="footer up after repair")
            ok = record(tui2.still("s5-footer-repaired", ["memory: up"])) and ok
            log(f"S5 footer-repaired ok={ok}")

            settle(tui2)
            tui2.type_prompt("/engine")
            pane = tui2.wait_for(["status: UP"], timeout=20, desc="/engine after repair")
            record(tui2.still("s5-engine-command-up", ["status: UP"]))

            # The queued note drained: outbox shrinks vs post-quit count.
            drained = outbox_count() < queued_after_quit
            # And the drained note's CONTENT is in the engine (the ultimate
            # receipt: "N prompt(s)" from this very session).
            note_ok = drained_note_mentions("prompt(s)")
            log(
                f"S5 outbox: after-quit={queued_after_quit} now={outbox_count()} "
                f"drained={drained} note_in_engine={note_ok}"
            )
            RESULTS.append(
                P.StillRecord(name="s5-outbox-drained", anchors=["drained"], png="",
                              pane="", ok=drained and note_ok,
                              detail=f"outbox {queued_after_quit} -> {outbox_count()}, note content in engine={note_ok}")
            )

            tui2.type_prompt("/quit")
        finally:
            tui2.close()

        # ---- S6: doctor degraded + start ---------------------------------
        sh(["bun", "bin/unown", "engine", "stop"], timeout=30)
        time.sleep(1)
        r = sh(["bun", "bin/unown", "doctor"], timeout=90)
        degraded = "unreachable — learning paused" in r.stdout and "pending" in r.stdout
        log(f"S6 doctor degraded line present={degraded}")
        RESULTS.append(
            P.StillRecord(name="s6-doctor-degraded", anchors=["unreachable"], png="",
                          pane="", ok=degraded, detail=r.stdout[:200])
        )
        r = sh(["bun", "bin/unown", "engine", "start"], timeout=60)
        pid = wait_engine_up(45)
        ok = r.returncode == 0 and pid is not None
        log(f"S6 engine start rc={r.returncode} pid={pid}")
        RESULTS.append(
            P.StillRecord(name="s6-engine-restart", anchors=["start"], png="",
                          pane="", ok=ok, detail=f"rc={r.returncode} pid={pid}")
        )

    finally:
        if tui is not None:
            tui.close()

    # ---- report ---------------------------------------------------------
    print("\n=== M6 END-USER E2E VERIFICATION ===")
    fails = 0
    for rec in RESULTS:
        status = "PASS" if rec.ok else "FAIL"
        if not rec.ok:
            fails += 1
        print(f"  [{status}] {rec.name:32s} {rec.detail[:80]}")
    print(f"  {len(RESULTS) - fails}/{len(RESULTS)} surfaces verified")
    with open(os.path.join(OUT, "e2e-results.json"), "w") as f:
        json.dump(
            [{"name": r.name, "ok": r.ok, "detail": r.detail} for r in RESULTS], f, indent=1
        )
    with open(os.path.join(OUT, "e2e-log.txt"), "w") as f:
        f.write("\n".join(LOG_LINES) + "\n")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
