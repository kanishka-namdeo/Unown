#!/usr/bin/env python3
"""
film_sessions_round.py — film the sessions-round dex reel (PTY lane).

Drives the REAL `unown` TUI through the round's story — a streaming turn,
/abort stopping it mid-flight (the notice, the kept partial, the resume
hint), then the in-session /resume picker listing BOTH stores — capturing
frames at a fixed cadence for scripts/tui-capture/assemble.py.

Outputs (OUT_ROOT default /home/z/my-project/download/unown-tui-captures):
  sessions-round/frames/NNNNN.jpg + frames-meta.jsonl
then:  python3 assemble.py sessions-round  -> .mp4/.webm/.gif + posters
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, make_logger, render_png  # noqa: E402

from PIL import Image  # noqa: E402

WORK_DIR = "/tmp/unown-film-sessions"
OUT_ROOT = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")
SCENARIO = "sessions-round"
CADENCE = 0.7  # seconds between frames

log = make_logger("film-sessions-round")


def main() -> None:
    os.makedirs(WORK_DIR, exist_ok=True)
    frames_dir = os.path.join(OUT_ROOT, SCENARIO, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    meta_path = os.path.join(OUT_ROOT, SCENARIO, "frames-meta.jsonl")
    meta_file = open(meta_path, "w", encoding="utf-8")
    frame_idx = 0
    last_hash = None

    def snap(session, tag: str) -> None:
        nonlocal frame_idx, last_hash
        png = os.path.join(frames_dir, f".tmp-{frame_idx:05d}.png")
        render_png(session.screen, png, "unown")
        im = Image.open(png).convert("RGB")
        import hashlib

        h = hashlib.md5(im.tobytes()).hexdigest()
        changed = h != last_hash
        last_hash = h
        jpg = os.path.join(frames_dir, f"{frame_idx:05d}.jpg")
        im.save(jpg, quality=72)
        os.remove(png)
        meta_file.write(json.dumps({"i": frame_idx, "tag": tag, "changed": changed, "working": False}) + "\n")
        meta_file.flush()
        frame_idx += 1

    # ---- beat 1: boot + a streaming turn --------------------------------
    s = UnownPty(log, cwd=WORK_DIR, extra_args=[])
    s.wait_ready(timeout=90)
    snap(s, "boot")
    s.type_prompt("Write a detailed 2500-word story about a lighthouse keeper named Mara.")
    s.send("\r")
    deadline = time.time() + 18
    while time.time() < deadline:
        s.pump(0.3)
        snap(s, "streaming")
        if frame_idx % 6 == 0:
            s.pump(0.2)
            snap(s, "streaming")

    # ---- beat 2: /abort mid-turn ----------------------------------------
    s.send("/abort")
    time.sleep(0.4)
    s.send("\r")
    for _ in range(8):
        s.pump(0.35)
        snap(s, "abort")
    time.sleep(1.2)
    snap(s, "abort-settled")

    # ---- beat 3: the /resume picker (both stores) -----------------------
    # seed the import lane so the picker shows two rows: export this session
    # and reimport it through the real CLI before opening the picker
    import glob
    import subprocess

    s.send("/quit")
    time.sleep(0.4)
    s.send("\r")
    time.sleep(1.0)
    s.close()
    files = sorted(glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl")), key=os.path.getmtime)
    sid = None
    for f in reversed(files):
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                if json.loads(fh.readline()).get("cwd") == WORK_DIR:
                    sid = os.path.basename(f).split("_")[-1].replace(".jsonl", "")
                    break
        except Exception:
            continue
    if sid:
        r = subprocess.run(
            ["bun", "/home/z/my-project/Unown/bin/unown", "sessions", "export", sid, "--out", "/tmp/film-export.json"],
            cwd=WORK_DIR, capture_output=True, text=True, timeout=120,
            env={**os.environ, "PATH": os.environ.get("PATH", "")},
        )
        log(f"export rc={r.returncode}")
        if r.returncode == 0:
            r2 = subprocess.run(
                ["bun", "/home/z/my-project/Unown/bin/unown", "sessions", "import", "/tmp/film-export.json"],
                cwd=WORK_DIR, capture_output=True, text=True, timeout=120,
                env={**os.environ, "PATH": os.environ.get("PATH", "")},
            )
            log(f"import rc={r2.returncode}")

    s2 = UnownPty(log, cwd=WORK_DIR, extra_args=[])
    s2.wait_ready(timeout=90)
    snap(s2, "reboot")
    s2.send("/resume")
    time.sleep(0.4)
    s2.send("\r")
    for _ in range(10):
        s2.pump(0.35)
        snap(s2, "picker")
    time.sleep(1.0)
    snap(s2, "picker-settled")
    s2.send("\x1b")
    time.sleep(0.5)
    s2.send("\x1b")
    time.sleep(0.5)
    s2.send("/quit")
    time.sleep(0.4)
    s2.send("\r")
    s2.close()

    meta_file.close()
    log(f"captured {frame_idx} frames -> {frames_dir}")
    print(f"frames={frame_idx}")


if __name__ == "__main__":
    main()
