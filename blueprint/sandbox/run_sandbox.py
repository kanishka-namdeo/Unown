#!/usr/bin/env python3
"""Unown sandbox — a disposable, keyless end-to-end test rig.

Every run gets a FRESH throwaway clone of this repository plus a synthetic
HOME directory, then drives the real scripts (hooks, memory digest, harness,
dreamer, router) through the exact interfaces Claude Code would drive them,
never touching your live checkout and never calling a model API.

What each scenario proves:
  S1  tiered-memory     user->project->local resolution & observability
  S2  hook-gate         PreToolUse deny/ask/pass decisions + secret redaction
  S3  hook-hygiene      PostToolUse formatting/logging + Stop-hook session scribe
  S4  auto-dream        offline consolidation: dedupe, incremental state, idempotence
  S5  self-improve      full harness loop: evals -> mine -> propose -> gate -> promote
  S6  router-fencing    headless-event prompt fencing, untrusted-data handling

Guarantees enforced by this runner:
- Offline: ANTHROPIC_API_KEY and friends are stripped from the child
  environment. Any script reaching for `claude` fails loudly instead of
  silently spending money.
- Isolated: all mutations land in sandbox/.runtime/<timestamp>/. At suite end
  the runner verifies your live repo is byte-identical and git-clean.

Usage:
  python3 sandbox/run_sandbox.py                 # full suite
  python3 sandbox/run_sandbox.py --scenario s2   # one scenario
  python3 sandbox/run_sandbox.py --list          # enumerate scenarios
  python3 sandbox/run_sandbox.py --keep          # keep runtime for inspection
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SANDBOX_DIR = Path(__file__).resolve().parent
REAL_REPO = SANDBOX_DIR.parent
FIXTURES = SANDBOX_DIR / "fixtures"
RUNTIMES = SANDBOX_DIR / ".runtime"

# Runtime-tree subtrees that must NOT be cloned into a fresh sandbox.
COPY_SKIP_TOP = {".git", "__pycache__", "node_modules", ".venv"}
COPY_SKIP_REL = {
    "sandbox/.runtime",
    "harness/runs", "harness/proposals", "harness/verdicts",
    "harness/weaknesses.json", "harness/unown_state.json",
    "unown/logs", "dreams/state.json", "unown_state.json",
}

KEY_VARS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY")


def _copy_ignore(dirpath: str, names: list[str]) -> set[str]:
    """copytree ignore hook: drop git/runtime noise, keep everything else."""
    rel_parent = Path(dirpath).relative_to(REAL_REPO)
    drop: set[str] = set()
    for n in names:
        if n in COPY_SKIP_TOP:
            drop.add(n)
            continue
        if (rel_parent / n).as_posix() in COPY_SKIP_REL:
            drop.add(n)
    return drop


def build_runtime(rt: Path) -> None:
    """Create <rt>/repo (clean git copy) and <rt>/home (synthetic HOME)."""
    repo = rt / "repo"
    shutil.copytree(REAL_REPO, repo, ignore=_copy_ignore)

    shutil.copytree(FIXTURES / "home", rt / "home")
    (rt / "empty-home").mkdir(exist_ok=True)  # HOME with no memory tiers

    id_cfg = ["-c", "user.name=Sandbox", "-c", "user.email=sandbox@unown.local"]
    for cmd in (
        ["init", "-q", "-b", "main"],
        ["add", "-A"],
        id_cfg + ["commit", "-qm", "sandbox-baseline"],
    ):
        subprocess.run(["git", "-C", str(repo)] + cmd, check=True,
                       capture_output=True, text=True)

    # Gitignored runtime dirs that scripts expect to exist (copytree skipped
    # them on purpose — recreate empty so the harness/dreamer/hooks can write).
    for rel in ("harness/runs", "harness/proposals", "harness/verdicts",
                "unown/logs", "dreams/sessions"):
        (repo / rel).mkdir(parents=True, exist_ok=True)


@dataclass
class Ctx:
    """Per-suite facilities handed to every scenario."""

    rt: Path
    home: Path = field(init=False)
    repo: Path = field(init=False)
    empty_home: Path = field(init=False)
    py: str = sys.executable or "python3"
    logs: list[str] = field(default_factory=list)
    base_env: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.home = self.rt / "home"
        self.empty_home = self.rt / "empty-home"
        self.repo = self.rt / "repo"
        env = dict(os.environ)
        for k in KEY_VARS:
            env.pop(k, None)  # sandbox is keyless by construction
        env.update({
            "HOME": str(self.home),
            "CLAUDE_PROJECT_DIR": str(self.repo),
            "PYTHONIOENCODING": "utf-8",
            "TZ": "UTC",
        })
        self.base_env = env

    # -- subprocess helper -------------------------------------------------
    def sh(self, cmd, *, cwd=None, env=None, input=None, timeout=120):
        merged = dict(self.base_env)
        if env:
            merged.update(env)
        pretty = " ".join(str(c) for c in cmd)
        self.log(f"$ {pretty}" + (f"   (cwd={Path(cwd).name})" if cwd else ""))
        try:
            proc = subprocess.run(
                [str(c) for c in cmd], cwd=str(cwd) if cwd else None,
                env=merged, input=input, capture_output=True,
                text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            self.log(f"  TIMEOUT after {timeout}s")
            raise
        self.log(f"  rc={proc.returncode}"
                 + (f"\n  stdout| {proc.stdout.strip()[:600]}"
                    if proc.stdout.strip() else "")
                 + (f"\n  stderr| {proc.stderr.strip()[:400]}"
                    if proc.stderr.strip() else ""))
        return proc

    def log(self, line: str) -> None:
        self.logs.append(line)


def load_scenarios() -> list:
    """Import sandbox/scenarios/sNN_*.py modules, sorted by filename."""
    mods = []
    scen_dir = SANDBOX_DIR / "scenarios"
    for path in sorted(scen_dir.glob("s[0-9]*_*.py")):
        spec = importlib.util.spec_from_file_location(
            f"unown_sbx_{path.stem}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for attr in ("NAME", "DESCRIPTION", "run"):
            if not hasattr(mod, attr):
                raise SystemExit(
                    f"[sandbox] {path.name} missing required attr '{attr}'")
        mods.append((path.stem, mod))
    return mods


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", action="append", metavar="ID",
                    help="run only matching scenario (s1..s6; repeatable)")
    ap.add_argument("--list", action="store_true", help="list scenarios and exit")
    ap.add_argument("--keep", action="store_true",
                    help="keep the runtime tree even on success")
    ap.add_argument("--runtime-dir", default=str(RUNTIMES))
    args = ap.parse_args()

    mods = load_scenarios()
    if args.list:
        for stem, mod in mods:
            print(f"{stem:<28} {mod.DESCRIPTION}")
        return 0

    sel = mods
    if args.scenario:
        ids = {s.lower().lstrip("s").zfill(2) for s in args.scenario}
        sel = [(stem, mod) for stem, mod in mods
               if stem.split("_")[0].lstrip("s").zfill(2) in ids]
        if not sel:
            print(f"[sandbox] no scenario matched {args.scenario}; "
                  f"try --list")
            return 2

    # Integrity baselines of the LIVE repo (isolation proof at suite end).
    real_runbook = REAL_REPO / "docs" / "RUNBOOK.md"
    rb_before = real_runbook.read_bytes()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rt = Path(args.runtime_dir) / stamp
    rt.mkdir(parents=True, exist_ok=False)
    print("=" * 72)
    print(f" Unown sandbox  |  runtime: {rt}")
    print(f" offline mode : stripped {', '.join(KEY_VARS)} from child env")
    print("=" * 72)

    ctx = Ctx(rt=rt)
    build_runtime(rt)
    n_files = sum(1 for _ in ctx.repo.rglob("*"))
    print(f"[sandbox] built disposable clone + synthetic HOME ({n_files} files)\n")

    results: list[tuple[str, bool, float, str, str]] = []
    t_all = time.time()
    for stem, mod in sel:
        label = f"S{stem.split('_')[0].lstrip('s')} {mod.NAME}"
        print(f"---- {label}: {mod.DESCRIPTION}")
        ctx.logs.clear()
        t0 = time.time()
        summary, err_tail = "", ""
        try:
            summary = mod.run(ctx) or "ok"
            status = True
        except Exception:
            status = False
            err_tail = traceback.format_exc(limit=3)
            if ctx.logs:
                err_tail += "\n--- scenario log tail ---\n" + "\n".join(ctx.logs[-14:])
        dt = time.time() - t0
        mark = "PASS" if status else "FAIL"
        print(f"     [{mark}] {dt:.1f}s"
              + (f" - {summary}" if status else "") + "\n")
        results.append((label, status, dt, summary or "", err_tail))


    total = time.time() - t_all
    n_ok = sum(1 for _, ok, *_r in results if ok)

    print("-" * 72)
    width = (max((len(lab) for lab, *_r in results), default=20)) + 2
    for label, ok, dt, summary, err in results:
        icon = "PASS" if ok else "FAIL"
        print(f" [{icon}] {label:<{width}} {dt:>5.1f}s  "
              f"{summary if ok else '(failed)'}")
        if not ok:
            tail = (err or "").strip().splitlines()[-12:]
            for ln in tail:
                print(f"       {ln}")
    failed = n_ok < len(results)
    print("-" * 72)
    print(f" Result: {n_ok}/{len(results)} scenarios PASSED ({total:.1f}s)")

    # Isolation proof against the live checkout.
    dirty = subprocess.run(
        ["git", "-C", str(REAL_REPO), "status", "--porcelain"],
        capture_output=True, text=True).stdout.strip()
    pristine = (rb_before == real_runbook.read_bytes()) and not dirty
    if pristine:
        print(" Live repo: untouched (byte-identical RUNBOOK, git-clean) PASS")
    else:
        print(" WARNING: live repo diverged outside the sandbox!")
        failed = True

    if args.keep or failed:
        print(f" Runtime KEPT for inspection: {rt}")
    else:
        shutil.rmtree(rt, ignore_errors=True)
        print(" Runtime cleaned up (use --keep to retain next time)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
