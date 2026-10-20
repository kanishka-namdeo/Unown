#!/usr/bin/env python3
"""beauty_critique.py — the numeric acceptance lane for the TUI beautification
plan (docs/tui-beautification-plan.md § Validation loop).

The audit gates (audit_stills.py / audit_video.py) answer "is this frame TRUE?"
(readable, artifact-free, plausible). This tool answers the plan's other
question: "is it BEAUTIFUL?" — a 0-10 polish score per still and a 0-10 motion
score per video, produced by the same VLM critique that baselined the pre-
beauty TUI (mean polish 3.9/10, mean motion 4.0/10 — the numbers the plan
targets ≥7 and ≥6 against). Prompts are kept verbatim from that baseline run
so the scores are directly comparable.

Lanes:
  stills [pattern]        polish-critique every OUT_ROOT/<scenario>/stills/*.png
                          (pattern filters the scenario, like audit_stills.py)
  motion <scenario> [n]   motion-critique an assembled <scenario>.mp4: n frames
                          (default 5) sampled evenly, sent together in ONE
                          request so the model judges temporal flow
  files <png...>          polish-critique ad-hoc image files (e.g. the PTY-lane
                          split-view stills, or the old landing assets as a
                          baseline) — paths are recorded as given

The VLM lane is the same bridge fallback the audit scripts use (z-ai CLI when
it works, else the local lane): BRIDGE_URL (default http://127.0.0.1:3031),
BRIDGE_VLM_MODEL (default agnes-3.0-flash). Raw reviews land in
$OUT_ROOT/_audit/polish/ and $OUT_ROOT/_audit/motion/ as the receipts;
aggregate summaries are appended to $OUT_ROOT/_audit/polish-summary.json and
motion-summary.json. Exit 0 always — this is a measuring tool, not a gate; the
targets live in the plan doc and RESULTS.md.

Usage:
  python3 beauty_critique.py stills hero-bugfix
  python3 beauty_critique.py motion hero-bugfix
  python3 beauty_critique.py files public/landing/tui/split-view/stills/*.png
"""
import base64
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CAPTURES = os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-tui-captures")
AUDIT = os.path.join(CAPTURES, "_audit")

# Verbatim from the baseline critique run (scripts that produced the plan's
# 3.9/10 and 4.0/10 baselines) — do not reword: comparability is the point.
STILL_PROMPT = """You are a senior terminal-UI (TUI) designer known for beautiful, restrained interfaces (think lazygit, fzf, Warp, charm-bracelet tools). This is a FULL-FRAME capture of the "unown" coding-agent TUI — exactly what the user sees while working (128x36 grid: header/transcript, input editor at the bottom, cwd + model status line).

Critique it as a product designer would, with the goal of BEAUTIFYING the interface. Look at: color harmony & contrast, hierarchy (what pulls the eye first — is it the right thing?), spacing/rhythm between blocks, borders & dividers, typography of the ASCII/ANSI text, status/footer design, density (too flat? too noisy?), emotional feel (does it feel premium? modern? dull?), and any visual bugs (misalignment, ragged edges, inconsistent padding).

Answer STRICTLY in this format:
SCORE: 1-10 overall visual polish
STRENGTHS: 2-3 things that already look good (max 12 words each)
DEFECTS: up to 6 concrete defects you actually see (max 18 words each, reference what/where)
BEAUTIFY: the 4 highest-leverage beautification moves for THIS screen (max 20 words each, be specific: colors, spacing, borders, layout)
No preamble."""

MOTION_PROMPT = """You are a senior terminal-UI designer and motion critic. These are 5 frames sampled evenly across a screen-recording of the "unown" coding-agent TUI (frame 1 = earliest). Judge the TEMPORAL experience a user would have watching this session: pacing (too fast/slow?), continuity between frames (does the layout jump or flow?), status feedback (is progress legible in motion?), text-arrival style (typewriter dumps vs streaming), overlay transitions, and whether the overall motion feels calm and premium or chaotic and cheap.

Answer STRICTLY in this format:
MOTION_SCORE: 1-10 (how premium the motion feels)
RHYTHM: one sentence on pacing/continuity
FEEDBACK: what does motion reveal that stills cannot (max 4 bullets, <=18 words each)
BEAUTIFY: 3 motion/animation beautification moves (<=20 words each)
No preamble."""


def bridge_vlm(prompt: str, images: list, max_tokens=900, timeout=180):
    """Same request shape as audit_stills.py's _bridge_vlm (multi-image capable)."""
    url = os.environ.get("BRIDGE_URL", "http://127.0.0.1:3031").rstrip("/")
    model = os.environ.get("BRIDGE_VLM_MODEL", "agnes-3.0-flash")
    content = [{"type": "text", "text": prompt}]
    for p in images:
        with open(p, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
            mime = "image/png" if p.lower().endswith(".png") else "image/jpeg"
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": max_tokens}).encode()
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    return raw.get("choices", [{}])[0].get("message", {}).get("content", "").strip()


def bridge_vlm_retry(prompt, images, max_tokens=900, attempts=3):
    last = None
    for a in range(attempts):
        try:
            return bridge_vlm(prompt, images, max_tokens=max_tokens)
        except Exception as e:
            last = str(e)[:200]
            time.sleep(5 * (a + 1))
    return f"VLMLANE_ERROR: {last}"


def parse_score(text, key="SCORE"):
    m = re.search(rf"{key}:?\s*([0-9]+(?:\.[0-9])?)\s*(?:/10)?", text or "")
    return float(m.group(1)) if m else None


def relpath(p):
    try:
        return os.path.relpath(p, CAPTURES)
    except ValueError:
        return p


def stills_lane(pattern):
    os.makedirs(os.path.join(AUDIT, "polish"), exist_ok=True)
    paths = sorted(
        p for p in glob.glob(os.path.join(CAPTURES, "*", "stills", "*.png"))
        if "_audit" not in p and (pattern == "*" or pattern in p)
    )
    if not paths:
        print("no stills matched", pattern)
        return 2
    print(f"polish-critiquing {len(paths)} stills (pattern={pattern}) …")

    def one(p):
        rel = relpath(p).replace("/", "__")
        out = os.path.join(AUDIT, "polish", rel + ".json")
        if os.path.exists(out) and not os.environ.get("FORCE"):
            with open(out) as f:
                rec = json.load(f)
        else:
            review = bridge_vlm_retry(STILL_PROMPT, [p])
            rec = {"path": relpath(p), "score": parse_score(review, "SCORE"), "review": review,
                   "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
            with open(out, "w") as f:
                json.dump(rec, f, indent=1)
        print(f"  {rec['score'] if rec['score'] is not None else '?':>4}  {relpath(p)}")
        return rec

    with ThreadPoolExecutor(max_workers=3) as ex:
        recs = list(ex.map(one, paths))

    by_scen = {}
    for r in recs:
        scen = r["path"].split(os.sep)[0]
        by_scen.setdefault(scen, []).append(r["score"])
    scored = [r["score"] for r in recs if r["score"] is not None]
    summary = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "pattern": pattern,
        "n": len(recs), "scored": len(scored),
        "mean_overall": round(sum(scored) / len(scored), 2) if scored else None,
        "per_scenario": {
            s: {"n": len([x for x in v if x is not None]),
                "mean": round(sum(x for x in v if x is not None) / max(1, len([x for x in v if x is not None])), 2)}
            for s, v in sorted(by_scen.items())
        },
        "receipts": [os.path.join("polish", relpath(p).replace("/", "__") + ".json") for p in paths],
    }
    print(f"\npolish mean: {summary['mean_overall']} over {len(scored)} scored stills")
    for s, v in summary["per_scenario"].items():
        print(f"  {s:22s} {v['mean']}/10  (n={v['n']})")
    _append_summary(os.path.join(AUDIT, "polish-summary.json"), summary)
    return 0


def files_lane(paths):
    """Polish-critique ad-hoc files (baselines, PTY-lane stills)."""
    os.makedirs(os.path.join(AUDIT, "polish"), exist_ok=True)
    tag = os.environ.get("TAG") or os.path.basename(os.path.dirname(os.path.dirname(paths[0]))) or "files"
    print(f"polish-critiquing {len(paths)} ad-hoc files (tag={tag}) …")

    def one(p):
        key = re.sub(r"[^A-Za-z0-9._-]+", "_", p)
        out = os.path.join(AUDIT, "polish", f"{tag}__{key}.json")
        if os.path.exists(out) and not os.environ.get("FORCE"):
            with open(out) as f:
                rec = json.load(f)
        else:
            review = bridge_vlm_retry(STILL_PROMPT, [p])
            rec = {"path": p, "tag": tag, "score": parse_score(review, "SCORE"), "review": review,
                   "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
            with open(out, "w") as f:
                json.dump(rec, f, indent=1)
        print(f"  {rec['score'] if rec['score'] is not None else '?':>4}  {p}")
        return rec

    with ThreadPoolExecutor(max_workers=3) as ex:
        recs = list(ex.map(one, paths))
    scored = [r["score"] for r in recs if r["score"] is not None]
    summary = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "n": len(recs),
               "mean": round(sum(scored) / len(scored), 2) if scored else None,
               "scores": {r["path"]: r["score"] for r in recs},
               "receipts": [os.path.join("polish", f"{tag}__" + re.sub(r"[^A-Za-z0-9._-]+", "_", p) + ".json") for p in paths]}
    print(f"\npolish mean ({tag}): {summary['mean']} over {len(scored)} scored")
    _append_summary(os.path.join(AUDIT, "polish-summary.json"), summary)
    return 0


def motion_lane(name, samples=5):
    mp4 = name if os.path.isfile(name) else os.path.join(CAPTURES, name, f"{os.path.basename(name)}.mp4")
    if not os.path.exists(mp4):
        print("no video:", mp4)
        return 2
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                "-of", "csv=p=0", mp4], capture_output=True, text=True).stdout.strip())
    outdir = os.path.join(AUDIT, "motion", os.path.splitext(os.path.basename(mp4))[0])
    os.makedirs(outdir, exist_ok=True)
    frames = []
    for i in range(samples):
        t = dur * (i + 0.5) / samples
        img = os.path.join(outdir, f"f{i}-t{t:.2f}.png")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", mp4,
                        "-frames:v", "1", "-vf", "scale=1400:-1", img], capture_output=True)
        if os.path.exists(img):
            frames.append(img)
    if not frames:
        print("no frames sampled from", mp4)
        return 2
    print(f"motion-critiquing {os.path.basename(mp4)} ({dur:.1f}s, {len(frames)} frames) …")
    review = bridge_vlm_retry(MOTION_PROMPT, frames, max_tokens=700)
    score = parse_score(review, "MOTION_SCORE")
    rec = {"video": mp4, "duration": dur, "frames": [os.path.basename(f) for f in frames],
           "score": score, "review": review, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
    out = os.path.join(AUDIT, "motion", os.path.splitext(os.path.basename(mp4))[0] + ".json")
    with open(out, "w") as f:
        json.dump(rec, f, indent=1)
    print(f"  MOTION {score}/10  → {out}")
    summary = {"ts": rec["ts"], "video": os.path.basename(mp4), "score": score,
               "receipt": os.path.join("motion", os.path.basename(out))}
    _append_summary(os.path.join(AUDIT, "motion-summary.json"), summary)
    return 0


def _append_summary(path, entry):
    hist = []
    if os.path.exists(path):
        try:
            with open(path) as f:
                hist = json.load(f)
        except Exception:
            hist = []
    hist.append(entry)
    with open(path, "w") as f:
        json.dump(hist, f, indent=1)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    lane = args[0]
    if lane == "stills":
        return stills_lane(args[1] if len(args) > 1 else "*")
    if lane == "files":
        return files_lane(args[1:])
    if lane == "motion":
        return motion_lane(args[1], int(args[2]) if len(args) > 2 else 5)
    print("unknown lane:", lane)
    return 2


if __name__ == "__main__":
    sys.exit(main())
