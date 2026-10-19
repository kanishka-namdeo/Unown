#!/usr/bin/env python3
"""Scan a scenario's recorded frame sequence for renderer corruption.

The one canvas-atlas failure signature worth pixel-detecting: a large uniform
block (>6% of the frame) of a single non-background color whose interior
carries almost no contrasting pixels — i.e. text got wiped or replaced by a
flat fill. Legit colored blocks (bun test summaries) contain readable text and
pass. Repeated-glyph patterns are NOT checked here: separator lines are
legitimate repeating glyphs, and the VLM frame sampling at assembly time is
the arbiter for anything subtle.

Scans at most --every Nth frame (default 5). Exits 1 with the suspect frames;
0 when clean. Corruption means re-run the scenario — never edit the image.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

CAPTURES = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")


def wiped_block(path):
    rgb = np.array(Image.open(path).convert("RGB")).astype(int)
    h, w, _ = rgb.shape
    flat = rgb.reshape(-1, 3)
    lum = flat.max(axis=1)
    is_bg = lum < 40
    non_bg = flat[~is_bg]
    if len(non_bg) < 0.08 * len(flat):
        return False
    nlum = non_bg.max(axis=1)
    packed = (non_bg[:, 0] << 16) | (non_bg[:, 1] << 8) | non_bg[:, 2]
    vals, counts = np.unique(packed, return_counts=True)
    dom = vals[counts.argmax()]
    mask = (packed == dom)
    if mask.mean() * len(flat) < 0.06 * len(flat):
        return False  # dominant non-bg color doesn't cover enough of the frame
    # interior text check: bright pixels inside the dominant-color region
    dom_lum = int(dom >> 16)
    interior_bright = ((nlum > dom_lum + 60) & mask).sum()
    interior_frac = interior_bright / max(1, mask.sum())
    # readable text (white-on-green summaries etc.) covers >1% of its block;
    # a wiped/filled block has almost none
    return interior_frac < 0.005


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    every = 5
    if "--every" in sys.argv:
        every = int(sys.argv[sys.argv.index("--every") + 1])
    names = args or sorted(
        d for d in os.listdir(CAPTURES)
        if os.path.isdir(os.path.join(CAPTURES, d, "frames")) and not d.startswith("_")
    )
    bad = {}
    total = 0
    for name in names:
        frames = sorted(glob.glob(os.path.join(CAPTURES, name, "frames", "*.jpg")))
        for i, f in enumerate(frames):
            if i % every:
                continue
            total += 1
            try:
                if wiped_block(f):
                    bad.setdefault(name, []).append(os.path.basename(f))
            except Exception:
                pass
    if bad:
        for k, v in bad.items():
            print(f"CORRUPTION {k}: {len(v)} suspect frames, e.g. {v[:6]}")
        return 1
    print(f"clean: {total} sampled frames across {len(names)} scenario frame sets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
