#!/usr/bin/env python3
"""dashboard_vlm_critique.py — landing-readiness critique of the TUI dashboard
stills via the Agnes VLM lane (agnes-3.0-flash through the llm-bridge, the
same wiring as beauty_critique.py / agnes_review.mjs).

Unlike beauty_critique.py's chat-TUI polish prompt (kept verbatim for
baseline comparability), this critique is scoped to what the dashboard stills
must prove for the landing page: data density / lived-in plausibility,
truncation, the emerald-on-zinc brand palette, and mock-looking artifacts.

Usage:
  python3 dashboard_vlm_critique.py <png...>     # one multi-image request
Env:
  BRIDGE_URL (default http://127.0.0.1:3031)
  BRIDGE_VLM_MODEL (default agnes-3.0-flash)
  OUT_DIR (default benchmarks/tui-beauty/dashboard-stills/receipts/vlm-critique)

Raw model output is preserved verbatim as the receipt; exit 0 always (a
measuring tool, not a gate).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from beauty_critique import bridge_vlm_retry  # noqa: E402

PROMPT = """You are a senior terminal-UI (TUI) designer and landing-page art director. These are full-frame captures of the "unown" TUI dashboard — a mission-control UI for a self-improving coding agent (128x36 terminal grid; brand palette: emerald accent on zinc-dark background, amber warnings). The LAST image shows the same dashboard embedded inside a live agent session (chat chrome visible below it). They will ship as landing-page showcase stills.

Critique each image for LANDING-USE quality:
- Data density: does it read as a real, lived-in system (plausible rows, fresh timestamps, internally consistent numbers) or as sparse/fake?
- Truncation: any mid-word clipping, ragged columns, or text cut at panel edges that looks BROKEN (vs intentional trailing-ellipsis)?
- Brand palette: is the emerald-on-zinc accent hierarchy clear; anything clashing or unreadable?
- Mock-looking artifacts: placeholder text, lorem-ipsum, "mock"/"test" vocabulary, impossible values, suspiciously duplicated rows?
- Overall: would a developer scrolling the landing page trust this is a real product?

Answer STRICTLY in this format, one block per image in order:
IMAGE 1: SCORE: <1-10 landing quality>
DEFECTS: <up to 4 concrete defects, max 18 words each, reference what/where>
VERDICT: SHIP or FIX
(then IMAGE 2, IMAGE 3, ... same shape)
OVERALL: <one sentence on the set>"""


def main() -> int:
    paths = [p for p in sys.argv[1:] if p.lower().endswith(".png")]
    if not paths:
        print(__doc__)
        return 2
    out_dir = os.environ.get(
        "OUT_DIR",
        os.path.join(
            os.environ.get("UNOWN_ROOT", "/home/z/unown"),
            "benchmarks/tui-beauty/dashboard-stills/receipts/vlm-critique",
        ),
    )
    os.makedirs(out_dir, exist_ok=True)
    print(f"Agnes critique of {len(paths)} stills (model={os.environ.get('BRIDGE_VLM_MODEL', 'agnes-3.0-flash')}) …")
    t0 = time.time()
    review = bridge_vlm_retry(PROMPT, paths, max_tokens=1100)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    receipt = os.path.join(out_dir, f"dashboard-stills-{stamp}.txt")
    with open(receipt, "w", encoding="utf-8") as f:
        f.write(f"# Agnes (agnes-3.0-flash) landing-readiness critique — {stamp}\n")
        f.write(f"# images ({len(paths)}), in order:\n")
        for i, p in enumerate(paths, 1):
            f.write(f"#   IMAGE {i}: {p}\n")
        f.write("\n" + review + "\n")
    print(f"({time.time() - t0:.1f}s) receipt → {receipt}\n")
    print(review)
    return 0


if __name__ == "__main__":
    sys.exit(main())
