#!/usr/bin/env python3
"""Audit captured TUI stills — a pane-truth + pixel + VLM gate.

The user-facing contract for landing-page assets: every frame must show
EVERYTHING the user sees in the TUI while working — every pane row the
terminal contained at still time, wherever the TUI laid it out (transcript,
input box, overlay selector, plan-progress footer) — and nothing the user
would NOT see (tmux status bar, browser chrome, overlays from the renderer).

Three evidence layers, because each alone misleads:
  1. PANE TRUTH (capture.log's `--- pane @still <name> ---` dump, taken right
     after each still): the exact rows the terminal held. The still is judged
     against ITS OWN pane, not against a fixed chrome layout — plan-mode
     overlays replace the input box (separators ~10 rows apart around a
     selector), plan execution replaces the model name with `plan N/M`, and
     CLI showcase frames have no unown chrome at all.
  2. PIXEL VERIFICATION: the separator lines the pane claims must appear as
     thin full-width runs at their expected y (self-calibrated from the first
     pair); the last two non-empty pane rows must have pixels in their bands
     (proves no bottom clipping); no solid bright band in the bottom 8% (the
     tmux status-bar artifact); frame signature of the calibrated render
     config (~2200x~1480).
  3. VLM CONTENT (GLM vision via `z-ai vision`): readable, artifact-free,
     plausible. The VLM is NOT asked about cropping or input-box presence —
     those are decided by pixels (its answers there were measured to be noisy:
     the same frame passed and failed across runs because an empty input row
     is only recognizable when the cursor block reads as a "box").

Exit 0 = all stills pass; 1 = failures (re-capture, never edit the image).
Usage: python3 audit_stills.py [scenario-name-substring]
"""
import glob
import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image

CAPTURES = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")
AUDIT_DIR = os.path.join(CAPTURES, "_audit")

VLM_PROMPT = """You are auditing a screenshot of a real developer terminal running "unown", an AI coding agent TUI. It will be used on a landing page.

Answer with STRICT JSON only (no markdown fence), with exactly these keys:
{"readable": true/false,        // is the text crisp and legible at this resolution?
 "no_artifacts": true/false,    // free of BROWSER chrome, scrollbars, debug overlays, watermarks, rendering glitches? NOTE: the unown TUI itself has footer lines (cwd, token usage, model name like kimi-k2.5, mode chips like PLAN) and selection menus between dashed separator lines — that is the app's OWN UI, NOT an artifact; never flag it
 "looks_real": true/false,      // does it look like a genuine working session (plausible commands, diffs, test output — not lorem ipsum, not empty)?
 "tui_visible": true/false,     // does it show a terminal UI in a dark theme with the unown agent conversation (transcript blocks, tool calls, diffs, menus, or status lines)?
 "issues": ["..."],             // empty if perfect; short strings otherwise
 "summary": "one sentence: what is happening in this frame"}

JSON:"""

SEP_RE = re.compile(r"^─{100,}$")


def pane_for_still(scenario_dir, still_name):
    """Parse the pane dump logged for one still: list of (row_index, text)."""
    log = os.path.join(scenario_dir, "capture.log")
    if not os.path.exists(log):
        return None
    m = re.search(
        rf"--- pane @still {re.escape(still_name)} ---\n(.*?)\n--- end pane ---",
        open(log, encoding="utf-8", errors="replace").read(), re.S,
    )
    if not m:
        return None
    rows = []
    for line in m.group(1).split("\n"):
        mm = re.match(r"^\s*(\d+)\|(.*)$", line)
        if mm:
            rows.append((int(mm.group(1)), mm.group(2).rstrip()))
    return rows or None


def widest_run_row(row_bool):
    best = cur = 0
    for v in row_bool:
        cur = cur + 1 if v else 0
        if cur > best:
            best = cur
    return best


def thin_wide_bands(im, w, y_from, y_to, min_frac=0.60):
    """y positions of thin (1-7px) horizontal runs covering >= min_frac width."""
    lum45 = im > 45
    out = []
    y = y_from
    while y < y_to:
        if lum45[y].mean() > min_frac and widest_run_row(lum45[y]) > min_frac * w:
            y2 = y
            while y2 + 1 < y_to and lum45[y2 + 1].mean() > min_frac:
                y2 += 1
            if 1 <= (y2 - y + 1) <= 7:
                out.append((y, y2))
            y = y2 + 1
        else:
            y += 1
    return out


def pixel_geometry(path, pane_rows):
    """Renderer-agnostic pane-vs-pixel verification. Returns (ok, details).

    Maps every non-empty pane row to its expected pixel band
    (row-1)*pitch..row*pitch (pitch = frame_height/36, tolerance overlap
    +-0.3 row to absorb the canvas offset) and requires non-background pixels
    there. This checks PRESENCE, not paint style: the canvas renderer paints
    separator lines as solid bright bars, the dom renderer as dim sparse
    glyph text -- both must satisfy "the row the pane claims is visible".
    """
    im = np.array(Image.open(path).convert("L"))
    h, w = im.shape
    det = {"frame": f"{w}x{h}"}
    if not (2000 <= w <= 2450 and 1350 <= h <= 1600):
        return False, {**det, "reason": "frame signature off (render config regression?)"}

    # tmux status-bar artifact: solid tall bright band in the bottom 8%
    bottom8 = im[int(h * 0.92):, :]
    rf = (bottom8 > 60).mean(axis=1)
    tmux_bar = bool((rf > 0.45).sum() > 22)
    det["tmux_bar"] = tmux_bar
    if tmux_bar:
        return False, {**det, "reason": "tmux status-bar artifact at the bottom"}

    if not pane_rows:
        return False, {**det, "reason": "no pane dump found for this still (capture.log missing section)"}

    nonempty = [r for r, t in pane_rows if t.strip()]
    if not nonempty:
        return False, {**det, "reason": "pane dump is entirely empty"}

    # exact grid geometry as measured by the driver (geometry.json written at
    # fit time); falls back to frame-derived estimate for legacy runs
    geo_path = os.path.join(os.path.dirname(os.path.dirname(path)), "geometry.json")
    off, pitch = None, None
    try:
        with open(geo_path) as f:
            g = json.load(f)
        off = float(g["elTop"])
        pitch = float(g["elH"]) / float(g["rows"])
    except Exception:
        pass
    if off is None or pitch <= 0:
        off, pitch = (h - 1440) / 2 + 14.0, 1440.0 / 36.0

    missing = []
    # verify every non-empty pane row has pixels in its band (anti-clipping)
    for r in nonempty:
        lo = max(0, int(off + (r - 1) * pitch - 12))
        hi = min(h, int(off + r * pitch + 12))
        band = im[lo:hi, :]
        if (band > 22).sum() < 30:  # zinc-950 bg sits at ~9-15 lum
            missing.append(r)
    det["rows_missing_pixels"] = missing
    det["rows_verified"] = len(nonempty)
    if missing:
        return False, {**det, "reason": f"pane rows {missing[:6]} have no pixels at their expected positions (clipped or not rendered)"}
    return True, det


def _old_pixel_geometry(path, pane_rows):
    """Deterministic pane-vs-pixel verification. Returns (ok, details)."""
    im = np.array(Image.open(path).convert("L"))
    h, w = im.shape
    det = {"frame": f"{w}x{h}"}
    if not (2000 <= w <= 2400 and 1350 <= h <= 1600):
        return False, {**det, "reason": "frame signature off (render config regression?)"}

    # tmux status-bar artifact: solid tall bright band in the bottom 8%
    bottom8 = im[int(h * 0.92):, :]
    rf = (bottom8 > 60).mean(axis=1)
    tmux_bar = bool((rf > 0.45).sum() > 22)
    det["tmux_bar"] = tmux_bar
    if tmux_bar:
        return False, {**det, "reason": "tmux status-bar artifact at the bottom"}

    if not pane_rows:
        return False, {**det, "reason": "no pane dump found for this still (capture.log missing section)"}

    max_row = max(r for r, _ in pane_rows)
    pitch = 1440.0 / 36.0  # calibrated canvas geometry (see docs/tui-capture-workflow.md)

    # 1) every separator row the pane claims must render as a thin wide band
    sep_rows = [r for r, t in pane_rows if SEP_RE.match(t.strip()) or (len(t.strip()) > 100 and set(t.strip()) == {"─"})]
    bands = thin_wide_bands(im, w, h // 3, h)
    det["pane_separators"] = len(sep_rows)
    det["pixel_bands"] = len(bands)
    if sep_rows and bands:
        # self-calibrate the row->y mapping from the first separator match
        off = None
        for b in bands:
            off = (b[0] + b[1]) / 2 - (sep_rows[0] - 1) * pitch
          # candidate offset; validated by matching a second row
        offsets = []
        for b in bands:
            o = (b[0] + b[1]) / 2 - (sep_rows[0] - 1) * pitch
            # check another separator row lines up with some band under this offset
            for sr in sep_rows[1:]:
                exp = o + (sr - 1) * pitch
                if any(abs((bb[0] + bb[1]) / 2 - exp) < 0.6 * pitch for bb in bands):
                    offsets.append(o)
                    break
        if not offsets:
            # fall back: match any two bands to any two pane separator rows
            for b in bands:
                for sr in sep_rows:
                    o = (b[0] + b[1]) / 2 - (sr - 1) * pitch
                    for sr2 in sep_rows:
                        if sr2 > sr:
                            exp = o + (sr2 - 1) * pitch
                            if any(abs((bb[0] + bb[1]) / 2 - exp) < 0.6 * pitch for bb in bands):
                                offsets.append(o)
                                break
        if offsets:
            off = float(np.median(offsets))
            missing = []
            for sr in sep_rows[-2:]:  # the bottom two separators are the chrome
                exp = off + (sr - 1) * pitch
                if not any(abs((bb[0] + bb[1]) / 2 - exp) < 0.8 * pitch for bb in bands):
                    missing.append(sr)
            det["separator_offset"] = round(off, 1)
            det["separators_missing"] = missing
            if missing:
                return False, {**det, "reason": f"pane separator rows {missing} not rendered"}
        else:
            det["separator_offset"] = None
    elif sep_rows and not bands:
        return False, {**det, "reason": "pane has separator lines but no thin wide bands found in pixels"}

    # 2) the last two non-empty pane rows must have content in their bands
    nonempty = [r for r, t in pane_rows if t.strip()]
    if not nonempty:
        return False, {**det, "reason": "pane dump is entirely empty"}
    off = det.get("separator_offset")
    if off is None:
        # no separators (CLI frames): calibrate offset from the frame itself:
        # canvas starts ~14px into the viewport at the calibrated config
        off = (h - 1440) / 2 + 4 if abs(h - 1484) < 40 else 14.0
    for r in nonempty[-2:]:
        exp = off + (r - 1) * pitch
        lo = max(0, int(exp - 0.3 * pitch))
        hi = min(h, int(exp + 1.3 * pitch))
        band = im[lo:hi, :]
        if (band > 45).sum() < 40:
            return False, {**det, "reason": f"pane row {r} (last content rows) has no pixels at its expected position"}
    det["last_rows_verified"] = nonempty[-2:]
    return True, det


def vlm_check(path, out_json, attempts=3):
    import time
    for a in range(attempts):
        r = subprocess.run(
            ["z-ai", "vision", "-p", VLM_PROMPT, "-i", path, "-o", out_json],
            capture_output=True, text=True, timeout=180,
        )
        if r.returncode == 0 and os.path.exists(out_json):
            break
        if a < attempts - 1:
            time.sleep(20 * (a + 1))
            continue
        return {"cli_error": (r.stderr or r.stdout or "")[:300]}
    try:
        with open(out_json) as f:
            raw = json.load(f)
        content = raw.get("content") or raw.get("choices", [{}])[0].get("message", {}).get("content", "")
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`").lstrip("json").strip()
        return json.loads(content)
    except Exception as e:
        return {"parse_error": str(e), "raw": (content or "")[:300]}


def main(pattern: str) -> int:
    os.makedirs(AUDIT_DIR, exist_ok=True)
    stills = sorted(
        p for p in glob.glob(os.path.join(CAPTURES, "*", "stills", "*.png"))
        if "_audit" not in p and (pattern == "*" or pattern in p)
    )
    if not stills:
        print("no stills matched", pattern)
        return 2
    print(f"auditing {len(stills)} stills (pane truth + pixels + VLM) …")
    results = []
    for p in stills:
        rel = os.path.relpath(p, CAPTURES)
        scenario_dir = os.path.dirname(os.path.dirname(p))
        still_name = os.path.splitext(os.path.basename(p))[0]
        pane = pane_for_still(scenario_dir, still_name)
        geo_ok, geo = pixel_geometry(p, pane)
        vout = os.path.join(AUDIT_DIR, rel.replace("/", "__") + ".json")
        v = vlm_check(p, vout)
        vlm_ok = isinstance(v, dict) and all(v.get(k) is True for k in ("readable", "no_artifacts", "looks_real"))
        ok = geo_ok and vlm_ok
        why = []
        if not geo_ok:
            why.append(f"geometry[{geo}]")
        if not vlm_ok:
            why.append(f"vlm[{v.get('issues') or v}]")
        results.append({"stills": rel, "pass": ok, "geometry": geo, "vlm": v})
        print(f"  {rel:70s} {'OK' if ok else 'FAIL: ' + ' '.join(why)[:150]}")

    bad = [r for r in results if not r["pass"]]
    report_path = os.path.join(AUDIT_DIR, f"stills-audit-{pattern.replace('*', 'all').replace('/', '-')}.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=1)
    print(f"\n{len(results) - len(bad)}/{len(results)} PASS, report → {report_path}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "*"))
