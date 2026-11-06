# H-8/H-9 retention — the promoted rows on a FULL post-recycle sandbox

**The twenty-fourth lineage, 2026-11-06 12:00 UTC** — the PROVE track's
"retained improvements" item: the registry's two PTY-lane promotions
(H-8: the harness fresh-install hardening; H-9: the fresh-boot gate
awareness) re-verified on a sandbox that went through a **full recycle**
(new clone at a new path, new `~/.unown`, new venv — the pty deps
re-pipped from the receipts' own instructions).

## The lanes (the promotion bars' own surfaces)

| Lane | Result | Detail |
|---|---|---|
| `verify_resume_hint.py` (the H-9 gate lane 1) | **ALL ASSERTIONS HELD** (1 run) | exit hint on all three paths (Ctrl+C, /quit, mid-stream double-Ctrl+C), the launcher-correct resume grammar (`unown --resume <uuid>`), the verbatim copy-paste resume on BOTH session kinds (clean + mid-stream-aborted, stopReason `aborted` persisted); stills captured (C-exit-hint, D-resumed-partial) |
| `verify_resume_picker.py` (the H-9 gate lane 2) | **3 consecutive PASS** + 1 transient | `PASS: the /resume picker lists BOTH stores` ×3 (12:00:33 / 12:00:57 / 12:01:13 UTC) — the export→import lane + the dual-store picker; ONE earlier run (11:59 UTC) timed out at the 90 s TUI-header wait — **un-reproduced on three immediate re-runs**; the transient's honest class: boot-timeout under concurrent engine dream activity (the engine was mid-dream-check at 11:59 — the pane never reached the ready anchor), NOT a keystroke/gate regression (the first-run gate was answered cleanly in all passing runs) |

## The verdict

Both promoted augmentations' surfaces are **green on a fresh, hostile
environment** — the improvements are durable code + shared-harness
procedures (retention by construction), and they survived not just a
session boundary but a full sandbox recycle. The one transient is
recorded, not papered over: if a future lineage reproduces the
boot-timeout-under-dream-concurrency class, it is a candidate B-register
entry (engine-concurrency shaped, not harness shaped).

## Environment

- Tree `26abb7f3` (= HEAD), bun 1.4.4, default `~/.unown`, the venv
  re-pipped (`pyte`/`pexpect`/`pillow`), `UNOWN_ROOT`/`UNOWN_BIN` per
  the H-8 single-source-of-truth law; the lanes' isolated VERIFY_HOMEs
  rode the ambient bridge (upstream 200, `agnes-3.0-flash`).
