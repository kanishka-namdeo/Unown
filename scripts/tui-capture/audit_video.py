#!/usr/bin/env python3
"""VLM-sample an assembled scenario video: pull N frames spread across the
MP4 and ask the vision model whether each is a clean, readable terminal frame.
The last frame is always sampled. Exit 1 when any sample shows corruption.
Usage: python3 audit_video.py <scenario> [samples]"""
import os
import subprocess
import sys
import json

CAPTURES = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")
PROMPT = 'Is this a normal readable terminal frame from an AI coding agent TUI session, or does it show renderer corruption (a solid block with no readable text, garbage or repeated glyph tiles, missing/chopped chrome)? Strict JSON only: {"clean": true/false, "readable": true/false, "notes": "short"}'


def main():
    name = sys.argv[1]
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    mp4 = os.path.join(CAPTURES, name, f"{name}.mp4")
    if not os.path.exists(mp4):
        print("no video:", mp4)
        return 2
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4],
        capture_output=True, text=True).stdout.strip())
    outdir = os.path.join(CAPTURES, "_audit", f"video-{name}")
    os.makedirs(outdir, exist_ok=True)
    ts = sorted({max(0.0, dur * (i + 1) / (samples + 1)) for i in range(samples)} | {max(0.0, dur - 0.2)})
    bad = []
    for i, t in enumerate(ts):
        img = os.path.join(outdir, f"s{i}.jpg")
        subprocess.run(["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", mp4, "-frames:v", "1", "-q:v", "3", img],
                       capture_output=True)
        if not os.path.exists(img):
            continue
        r = subprocess.run(["z-ai", "vision", "-p", PROMPT, "-i", img, "-o", img + ".json"],
                           capture_output=True, text=True, timeout=180)
        verdict = {}
        try:
            raw = json.load(open(img + ".json"))
            c = raw.get("content") or raw.get("choices", [{}])[0].get("message", {}).get("content", "")
            c = c.strip().strip("`").lstrip("json").strip()
            verdict = json.loads(c)
        except Exception:
            verdict = {"clean": None, "readable": None, "notes": "vlm unavailable"}
        ok = verdict.get("clean") is True and verdict.get("readable") is True
        print(f"  {name} @{t:5.1f}s  {'OK' if ok else 'FAIL'} {verdict.get('notes','')[:80]}")
        if not ok:
            bad.append((t, verdict.get("notes")))
    print(f"{name}: {len(ts) - len(bad)}/{len(ts)} samples clean")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
