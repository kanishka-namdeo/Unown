# The Etude round — validation log (V-1..V-4) + harness-defect evidence

One-line purpose: the Etude round's failure ledger — every entry dated,
classified, and disposed with its receipt; the B-13/B-14 evidence lives
here in full.

## The ledger

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | Sandbox recycle reclaimed `fd` 10.2.0 and playwright's `chromium_headless_shell-1248` (2026-11-05, bring-up) | infra-flake (known class) | Cured from the bring-up checklist (fd → `/home/z/.npm-global/bin/fd`; `bunx playwright install chromium`). Explicitly NOT the root cause of the resume-lane failures — recorded so the next lineage does not re-diagnose |
| V-2 | `verify_resume_hint.py` PaneTimeout at `wait_ready` on a wiped VERIFY_HOME — the provision step leaked ambient `UNOWN_HOME` into its setup subprocess (2026-11-05) | genuine-gap (harness) | Ticket A2H-5; evidence below |
| V-3 | `verify_resume_picker.py` PaneTimeout at `wait_ready` on a wiped VERIFY_HOME — the lane provisions nothing and the first boot of any fresh home deterministically blocks on the pre-TUI first-run gate (2026-11-05) | genuine-gap (harness + receipt correction) | Ticket A2H-6 + the H-9 helper hypothesis; evidence below |
| V-4 | The full pre-ticket baseline re-run: every gate green (the README's table) | receipt | The round's baseline snapshot |

## V-2 evidence — the resume-hint lane's ambient `UNOWN_HOME` leak

The lane's provision step (2026-11-05, tree `f3f0176e`):

```python
# scripts/tui-capture/verify_resume_hint.py, main():
proc = subprocess.run(
    ["bun", UNOWN_BIN, "setup", "--provider", "bridge"],
    cwd=WORK_DIR,
    env={**os.environ, **env_extra()},   # <-- inherits ambient UNOWN_HOME
    ...
)
```

With `UNOWN_HOME=/home/z/my-project/unown-home` exported in the caller's
shell (the standing convention), `setup` provisioned the OPERATOR's home —
the receipt is the ambient home gaining `model-specs.json` +
`model-spec-cache.json` (5.9 MB) at the lane's run time — while the lane's
isolated HOME stayed cold. The TUI spawn itself is clean (`pty_common.py`
pops `UNOWN_HOME`, the V-4/H-8 fix), so the boot hit the pre-TUI
first-run gate and `wait_ready` timed out at 120 s.

**Controlled experiment (the root-cause receipt)**: on a scratch home,

```bash
rm -rf /tmp/test-setup-home && mkdir -p /tmp/test-setup-home
cd /tmp && env -u UNOWN_HOME HOME=/tmp/test-setup-home \
  timeout 120 bun /home/z/my-project/Unown/bin/unown setup --provider bridge
ls -la /tmp/test-setup-home/.unown/agent/
```

wrote `models.json`, `model-specs.json`, `model-spec-cache.json` and
**`settings.json`** — and `settings.json` existing flips the gate's
`created` flag false (`created: models.fresh || !settingsExisted`,
`pi-repo/packages/self-learning/src/term.ts:276`), so the next TUI boot
skips the gate. The fix is therefore exactly the H-8 subprocess env filter
(drop `UNOWN_HOME` from the setup call's env), already proven in the
picker lane's export/import calls.

**Run matrix (2026-11-05)**: wiped home + ambient `UNOWN_HOME` exported →
FAIL (PaneTimeout, `/tmp/rh.log`); warm home (post-first-boot) → **exit 0,
ALL ASSERTIONS HELD** (`/tmp/rh2.log` — chunks A-D all green, hint ids
match session files, abort persistence receipted).

## V-3 evidence — the fresh-home first-boot gate block

The gate (`pi-repo/packages/self-learning/src/cli.ts:3595-3618`, landed
2026-10-22 as onboarding 2.0) asks, before the TUI takes the screen on a
fresh seed:

```
First run — no provider connected yet.
Connect one now? (Agnes, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, local…)
  Enter = guided setup · n = keep the bundled bridge for now [Y/n]
```

It blocks on stdin; `wait_ready` waits for the TUI header anchor
(`── Themes ──`) which never renders. Manual repro (the pane-truth
receipt, 90 s of pane dumps at 10 s intervals —
`.a1/scripts/repro_boot_pane.py`, output in the round log's receipts):

| Run | Home state | Result |
|---|---|---|
| verify_resume_picker.py, run 1 | wiped (`/tmp/unown-picker-home` absent) | FAIL — PaneTimeout 90 s |
| verify_resume_picker.py, run 2 (post-fd) | still cold (no `settings.json`) | FAIL — PaneTimeout 90 s |
| verify_resume_picker.py, run 3 | warm (run 2's boot wrote `settings.json` + `models.json`) | **PASS** — both stores listed, exit 0 |
| verify_resume_hint.py, run 1 | wiped | FAIL — PaneTimeout 120 s |
| verify_resume_hint.py, run 3 | warm | **PASS** — exit 0, ALL ASSERTIONS HELD |
| manual repro (bare `unown` boot) | wiped | gate observed on pane, 9 consecutive dumps |

**The receipt correction**: the H-8 registry row's "fresh install 3/3
PASS" claim for the picker lane holds only for homes pre-warmed by an
earlier boot; on a wiped home the lane is deterministically red. The
sixteenth lineage's PASS is best explained by a pre-warmed VERIFY_HOME
(an earlier boot in the same sandbox session); the correction is filed
against the receipt, not the promotion (the `pty_common` hardening H-8
landed is real and this lineage relies on it).

**The durable fix shape (A2H-6, preferred)**: a pane-aware
`first_run_gate` helper in `pty_common.py` — pump once before
`wait_ready`; if the gate text is on the pane, send `n` + Enter (keep the
bundled bridge) and continue. This exercises the product's real first-run
flow instead of bypassing it, and every fresh-home lane inherits it. The
fallback shape: env-filtered `setup --provider bridge` provisioning in the
lane (A2H-5's pattern).

## Standing verifier (post-fix)

After A2H-5/A2H-6 land, the pinned regression is:

```bash
rm -rf /tmp/unown-resume-hint-home /tmp/unown-picker-home
python3 scripts/tui-capture/verify_resume_hint.py    # exit 0
python3 scripts/tui-capture/verify_resume_picker.py  # exit 0
# x3 consecutive, ambient UNOWN_HOME deliberately exported
```
