"""Scenario package for the Unown sandbox.

Each module `sNN_name.py` exposes:
  NAME         short label used in the report
  DESCRIPTION  one-liner printed by the banner and --list
  run(ctx)     executes assertions; returns a human summary string or None;
               raises AssertionError on failure.

`ctx` is sandbox.run_sandbox.Ctx providing ctx.repo (disposable clone),
ctx.home (synthetic HOME), ctx.empty_home, ctx.fixtures? -> fixtures live at
SANDBOX/fixtures; helper ctx.sh(cmd, cwd=..., input=..., timeout=...)
runs a subprocess with the controlled environment.
"""
