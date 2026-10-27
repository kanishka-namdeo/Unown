#!/usr/bin/env python3
"""Assemble captured frames into landing-page video assets (MP4/WebM/GIF).

Usage: python3 assemble.py <scenario-name> [--fps 8] [--width 1600]

Pacing model (8fps output, 125ms per frame):
  - spinner-idle runs (agent "Working..." with no content change): compress to 2+2 frames
  - static byte-identical runs (dwell/heartbeat duplicates): keep <= 8 frames (1s),
    final run <= 14 frames (1.75s) so the end state lingers
  - trailing idle run (frames after the last active frame per frames-meta):
    one final dwell (~2.2s) + the true final frame — the post-session tail
    (e.g. the wait-burn after a still-time anchor misses and the harness
    keeps recording an already-finished session) is harness time, not
    story; footer-heartbeat deltas split it into many dwell runs that rule
    2 alone kept as ~16s of dead ending (builder round, 2026-10-27)
  - everything else plays as captured
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

OUT_ROOT = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")

def run(cmd):
    print("+", " ".join(cmd[:5]), "…")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        sys.exit(f"ffmpeg failed: {' '.join(cmd[:4])}")

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    name = sys.argv[1]
    fps = "8"
    width = "1600"
    args = sys.argv[2:]
    if "--fps" in args:
        fps = args[args.index("--fps") + 1]
    if "--width" in args:
        width = args[args.index("--width") + 1]
    sdir = os.path.join(OUT_ROOT, name)
    fdir = os.path.join(sdir, "frames")
    meta_path = os.path.join(sdir, "frames-meta.jsonl")
    frames = sorted(f for f in os.listdir(fdir) if f.endswith(".jpg"))
    if not frames:
        sys.exit("no frames")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            for l in f:
                if l.strip():
                    m = json.loads(l)
                    meta[m["i"]] = m
    print(f"scenario={name} frames={len(frames)} meta={len(meta)}")

    hashes = [md5(os.path.join(fdir, f)) for f in frames]

    keep = set()
    n = len(frames)

    # 1) spinner-idle runs via meta: consecutive indices with working && !changed
    i = 0
    while i < n:
        m = meta.get(i)
        if m and m.get("working") and not m.get("changed"):
            j = i
            while j < n:
                mm = meta.get(j)
                if mm and mm.get("working") and not mm.get("changed"):
                    j += 1
                else:
                    break
            run_len = j - i
            if run_len <= 4:
                keep.update(range(i, j))
            else:
                # spinner samples were taken ~1.6s apart; keep one per ~2s of
                # real wait, capped at 20 frames (~2.5s on screen) — the wait
                # is work the viewer should feel, not sit through
                step = max(1, min(5, run_len // 20))
                keep.update(range(i, j, step))
                keep.update(range(max(i, j - 2), j))
            i = j
        else:
            i += 1

    # 2) static byte-identical runs among the rest
    i = 0
    while i < n:
        j = i
        while j + 1 < n and hashes[j + 1] == hashes[i]:
            j += 1
        run_len = j - i + 1
        if run_len > 1 and not any(k in keep for k in range(i, j + 1)):
            if j == n - 1:
                cap = 18  # final dwell (~2.2s)
            else:
                cap = 12  # 1.5s
            for k in range(i, min(j + 1, i + cap)):
                keep.add(k)
        elif run_len == 1:
            keep.add(i)
        i = j + 1

    # 2b) trailing idle run: frames after the last active frame (meta
    # changed|working) are post-session idle — harness time, not story. A
    # footer heartbeat (the "memory:" chrome line refreshing every ~50s)
    # keeps those frames byte-DISTINCT, so rule 2 sees many short dwell
    # runs and kept ~16s of dead ending on the builder-round cut. Treat
    # the whole tail as ONE dwell: keep its head (~2.2s) plus the true
    # final frame, drop the middle. Skipped when meta has no active frame
    # at all (legacy runs) or the capture ended mid-session.
    last_active = -1
    for i in range(n):
        m = meta.get(i)
        if m and (m.get("changed") or m.get("working")):
            last_active = i
    if 0 <= last_active < n - 1:
        idle = {i for i in range(last_active + 1, n) if i in keep}
        if idle:
            head = sorted(idle)[:18]
            for i in idle - set(head) - {n - 1}:
                keep.discard(i)

    # 3) drop near-blank frames (page-reload resyncs between stills paint a
    # dark empty screen for ~2s — they are harness plumbing, not user-visible
    # states; the final dwell is always kept)
    from PIL import Image as _PILImage
    import numpy as _np
    for i in range(n - 1):
        if i not in keep:
            continue
        try:
            im = _np.array(_PILImage.open(os.path.join(fdir, frames[i])).convert("L"))
            # near-UNIFORM in ANY luminance band: the G8 page-reload resync
            # windows paint solid states — the ttyd page's dark pre-attach,
            # the browser's white pre-CSS flash, xterm's mid-gray mid-attach
            # (found live, dream-dashboard 2026-10-23: a solid-gray frame at
            # the still-01 desync reload sailed into the MP4 and failed the
            # video VLM gate). A frame whose pixels sit >=99.5% inside one
            # 32-wide luminance band is plumbing, not content — a real TUI
            # frame spreads across bands (dark bg + bright text + color).
            hist, _ = _np.histogram(im, bins=8, range=(0, 256))
            if hist.max() >= 0.995 * im.size:
                keep.discard(i)
        except Exception:
            pass

    kept = sorted(keep)
    print(f"pacing: {n} -> {len(kept)} frames")

    seq_dir = os.path.join(sdir, "seq")
    shutil.rmtree(seq_dir, ignore_errors=True)
    os.makedirs(seq_dir)
    for new_i, old_i in enumerate(kept):
        shutil.copyfile(os.path.join(fdir, frames[old_i]), os.path.join(seq_dir, f"f_{new_i:05d}.jpg"))
    total = len(kept)
    print(f"sequence: {total} frames @ {fps}fps = {total / int(fps):.1f}s")

    seq = os.path.join(seq_dir, "f_%05d.jpg")
    mp4 = os.path.join(sdir, f"{name}.mp4")
    run(["ffmpeg", "-y", "-framerate", fps, "-i", seq,
         "-vf", f"scale={width}:-2:flags=lanczos", "-c:v", "libx264", "-crf", "19",
         "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4])
    webm = os.path.join(sdir, f"{name}.webm")
    run(["ffmpeg", "-y", "-framerate", fps, "-i", seq,
         "-vf", f"scale={width}:-2:flags=lanczos", "-c:v", "libvpx-vp9", "-crf", "32",
         "-b:v", "0", "-row-mt", "1", "-threads", "4", "-deadline", "good", "-cpu-used", "4",
         "-pix_fmt", "yuv420p", webm])
    gif = os.path.join(sdir, f"{name}.gif")
    pal = os.path.join(sdir, "palette.png")
    run(["ffmpeg", "-y", "-framerate", fps, "-i", seq,
         "-vf", f"fps={fps},scale=880:-1:flags=lanczos,palettegen=stats_mode=diff", pal])
    run(["ffmpeg", "-y", "-framerate", fps, "-i", seq, "-i", pal,
         "-lavfi", f"fps={fps},scale=880:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3",
         gif])
    os.remove(pal)
    for f in (mp4, webm, gif):
        print(f"{os.path.basename(f)}  {os.path.getsize(f)/1024:.0f} KB")

if __name__ == "__main__":
    main()
