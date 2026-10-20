# TUI Beauty — Acceptance Receipts

Runner: the `scripts/tui-capture/` harness (`driver.js` + `audit_stills.py` + `audit_video.py` + `scan_frames.py`), plus `scripts/tui-capture/beauty_critique.py` — the numeric acceptance lane this release adds (its critique prompts are kept verbatim from the baseline run that produced [docs/tui-beautification-plan.md](../../docs/tui-beautification-plan.md)'s 3.9/10 and 4.0/10 numbers, so scores are directly comparable). Captured 2026-10-20 against the live stack (bridge + engine, kimi-k2.5 via the Dashscope bridge) at `ac07278` with the beauty trilogy (beauty-1/2/3) in effect. Receipts: `_audit/` under the capture root — per-still audit JSONs, `polish-summary.json`, `motion-summary.json`, and per-video frame-sample verdicts. The audited set ships as `public/landing/tui/`.

## Headline metrics vs the plan's targets

| Metric (plan § Validation loop) | Baseline | Target | Measured (this run) | Verdict |
|---|---|---|---|---|
| Wall-of-green share, hero editing frame | **62%** (pre-beauty-1 pixel ground truth, plan §3) | < 10% | **0.45%** green-family / **0.01%** exact-emerald tone (`hero-bugfix/stills/04-agent-editing.png`; the investigating frame reads 0.45%, the red-test frame 0.33%) | **PASS** — an order of magnitude under |
| Still-critique mean polish | **3.9/10** (baseline critique, 14 stills) | ≥ 7/10 | **4.7/10** over 44 stills (10 scenarios) | **MISS** — +0.8 over baseline; see Notes |
| Motion-critique mean | **4.0/10** (baseline critique) | ≥ 6/10 | **5.0/10** over 9 videos; **hero-bugfix 7.0** — the plan's headline motion lane — passes | **MISS overall / hero PASS** |

## Per-scenario audit + critique table

| Scenario | Stills | Stills audit (pane-truth + pixel + VLM gate) | Video frame sampling (VLM) | Polish mean | Motion score |
|---|---|---|---|---|---|
| hero-bugfix | 6 | **6/6 PASS** | 5/5 clean | 5.33 | **7.0** |
| plan-mode | 5 | **5/5 PASS** | 5/5 clean | 5.60 | 3.0 |
| checkpoints | 4 | **4/4 PASS** | 5/5 clean | 5.00 | 7.0 |
| overlays | 5 | **5/5 PASS** | 5/5 clean | 4.40 | 5.0 |
| review | 4 | **4/4 PASS** | 5/5 clean | 5.25 | 4.0 |
| subagent-explore | 4 | **4/4 PASS** | 5/5 clean | 4.25 | 6.0 |
| wiki | 3 | **3/3 PASS** | 5/5 clean | 4.33 | 5.0 |
| cli-doctor | 3 | **3/3 PASS** | 5/5 clean | 3.33 | 2.0 |
| fleet | 5 | **5/5 PASS** | 5/5 clean (confirmatory run; first run 4/5 — a single-sample VLM flake, both runs' verdicts recorded in `_audit/video-fleet/`) | 4.20 | 6.0 |
| split-view | 5 (PTY lane) | pane-dump verified (`.pane.txt` ground truth per still; the landing README documents the PTY provenance) | n/a (stills-only lane) | 4.60 | n/a |

Stills-gate total: **39/39 PASS** across the nine ttyd-lane scenarios.

## Notes and honest caveats

- **The polish target was optimistic; the miss is reported as measured.** The trilogy's own receipts told both stories: beauty-2's showcase critique scored its surfaces 6.7–8, while the *verbatim* baseline prompt over the full landing set reads 4.7 — the baseline prompt grades a whole working terminal (information density, cursor-liveness, transcript walls), not just the beautified chrome, and the biggest residual deductions across the receipts are layout-density critiques the plan's follow-up tier (the beauty-4 release: session diff-stat chip, subagent color lanes, working-line shimmer) targets next. The receipts to re-run after beauty-4: `python3 scripts/tui-capture/beauty_critique.py stills` and `... motion hero-bugfix`.
- **Motion is dragged by inherently static scenes**: plan-mode's 43 s video (long bounded waits) and cli-doctor (a plain shell-output showcase with no TUI motion) read 3.0 and 2.0; the four agent-turn scenarios with real tool choreography (hero 7.0, checkpoints 7.0, subagent-explore 6.0, fleet 6.0) mean **6.5/10** — above the plan target as a class.
- **Wall-of-green method** (`green_share.py`, run on the fresh stills): a pixel counts as green-family when HSV hue ∈ [100°, 170°] with S ≥ 0.25, V ≥ 0.35; the exact-tone lane is |px − #10b981| ≤ 48 per channel. The archived post-beauty-1 hero set reads the same 0.45% — the 62% baseline is the pre-beauty-1 frame documented in the plan and in beauty-1's changelog entry (no pre-beauty-1 still survives on disk; the landing set was already post-beauty-1 when archived).
- **Provenance of this set**: a full re-capture of all ten scenarios (the prior landing set dated to `19439ba`/`bccaba4`, pre-beauty-2/3). Two lanes needed redo during the run and got it: the wiki scenario crashed after one still (driver died mid-turn; re-ran clean, 3/3), and hero-bugfix's first aggregate audit was produced through a broken vision lane (all-false with `cli_error`); it was re-audited on the working bridge lane — 6/6 PASS, the stale JSON overwritten.
- **VLM lane**: all critiques and audits run through the local bridge (`localhost:3031`) — the audit scripts' z-ai CLI lane is broken on this host and falls back per their committed logic; the working lane's receipts identify `glm-5v-turbo` (upstream) / `agnes-3.0-flash` (local fallback) per request.
- **Re-run everything**: `bash scripts/tui-capture/prep_demo.sh <scenario>`, `node scripts/tui-capture/driver.js scripts/tui-capture/scenarios/<scenario>.js`, `python3 scripts/tui-capture/audit_stills.py <scenario>`, `python3 scripts/tui-capture/audit_video.py <scenario> 4`, `python3 scripts/tui-capture/beauty_critique.py stills <scenario>` / `motion <scenario>` (workflow contract in [docs/tui-capture-workflow.md](../../docs/tui-capture-workflow.md)).
