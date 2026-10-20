#!/usr/bin/env python3
"""green_share.py — the wall-of-green pixel receipt for benchmarks/tui-beauty/RESULTS.md.

Measures the fraction of a still's pixels painted in the accent-green family
(the message/tool background fills beauty-1 abolished). A pixel counts as
"green fill" when its hue sits in the green family with enough saturation and
value to read as a painted fill (not dim text), i.e.:
  HSV: 100° <= hue <= 170°, S >= 0.25, V >= 0.35  (loose family bound),
plus an exact-tone lane: |px - emerald500(#10b981)| <= 48 (per-channel).

Both numbers are reported; the family share is the wall-of-green share the
plan targets (<10%; pre-beauty baseline was 62% on the editing frame).
"""
import sys
from PIL import Image
import numpy as np


def green_share(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # exact-tone lane: near emerald-500 #10b981 (16,185,129)
    exact = (np.abs(r - 16) <= 48) & (np.abs(g - 185) <= 48) & (np.abs(b - 129) <= 48)
    # family lane: green-ish hue with real saturation/value
    mx = a.max(-1)
    mn = a.min(-1)
    v = mx / 255.0
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    hue = np.zeros_like(mx)
    m = mx == r
    hue[m] = ((g - b)[m] / np.maximum(mx - mn, 1e-6)[m]) % 6
    m = mx == g
    hue[m] = ((b - r)[m] / np.maximum(mx - mn, 1e-6)[m]) + 2
    m = mx == b
    hue[m] = ((r - g)[m] / np.maximum(mx - mn, 1e-6)[m]) + 4
    hue = hue * 60
    family = (hue >= 100) & (hue <= 170) & (sat >= 0.25) & (v >= 0.35)
    tot = a.shape[0] * a.shape[1]
    return 100.0 * family.sum() / tot, 100.0 * exact.sum() / tot


if __name__ == "__main__":
    for p in sys.argv[1:]:
        fam, exact = green_share(p)
        print(f"{p}: green-family {fam:.2f}%  emerald-tone {exact:.2f}%")
