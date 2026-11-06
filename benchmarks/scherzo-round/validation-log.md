# The Scherzo round — validation log (§5: failure → benchmark → improvement → rerun)

Format (inherited): every entry names its class per §3 —
{stale-assumption, infra-flake, prompt-brittleness, genuine-gap,
upstream-change, operator-tooling}. Nothing is patched around silently.

---

## V-1 — battery.sh ran zero lanes then crashed on an empty map (operator-tooling)

- **What**: the rebuilt `battery.sh` completed instantly with no lanes
  run, then died: `line 67: FAIL: unbound variable`. Root cause: with no
  positional args, `WANTED=("${@:-}")` expands to a ONE-element array
  containing the empty string, so the "explicit lanes" selection path
  matched nothing; and `set -u` + `"${!FAIL[@]}"` on an empty associative
  array is unbound in this bash.
- **Repro**: `bash battery.sh` with zero args on bash 5.x with `set -u`.
- **Fix**: explicit `WANTED=()` construction + plain-string accumulators
  (`PASS_LIST`/`FAIL_LIST`) instead of assoc arrays.
- **Rerun**: the full 11-lane battery then ran ALL GREEN (baseline
  receipt, README §1). Class: **operator-tooling** (the operator's own
  harness, not A2).

## V-2 — the split-home trap: smokes seeded the DEFAULT home, not UNOWN_HOME (stale-assumption)

- **What**: the C1 smokes (run from `/tmp`) wrote their sessions to
  `~/.unown/agent/sessions` and seeded `~/.unown/agent/models.json` with
  the curated 65536 maxTokens — because `UNOWN_HOME` is set in the repo's
  `.env` (service-side) but is NOT exported into an operator shell that
  runs `unown -p` outside the repo cwd.
- **Risk**: any dispatch that forgets to export `UNOWN_HOME` rides an
  unpinned home — the exact V-38 upstream-400 window.
- **Fix (two layers)**: (a) `a1-dispatch.py` now force-exports
  `UNOWN_HOME` (env-overridable) on every dispatch; (b) `v38-pin.py` pins
  BOTH homes (`/home/z/my-project/unown-home` and `~/.unown`) — 4 fields
  pinned, verified. Class: **stale-assumption** (caught at canary stage,
  zero dispatch cost).

## V-3 — repo-wide `rg` name-check hangs the 120 s tool budget (operator-tooling)

- **What**: an `rg -il <name>` over the repo cwd (no path arg) blew the
  120 s Bash timeout (the walk includes non-ignored build artifacts).
- **Fix**: the name-availability check now uses `git grep -il` (index
  only, tracked files) — sub-second. Standing law: **repo-wide text
  searches on this tree go through `git grep` or a scoped `rg <path>`**,
  never bare `rg` from the repo root. Class: **operator-tooling**.

## V-4 — a repo write landed mid-battery (the Rondo V-3 law brushed; no harm)

- **What**: `scripts/a1-continue.py` was written into the repo tree while
  the baseline battery was mid-run (test:unit lane). The law says no
  tree writes during a battery.
- **Honest accounting**: no lane reddened (a `.py` under `scripts/` is
  invisible to tsc/eslint/`bun test src`/check:docs), and the battery
  completed ALL GREEN — but the law exists because the COST of a reddened
  lane is a full battery re-run (V-3 Rondo), so the brush is logged.
- **Standing law reaffirmed**: drafts land in `/home/z/my-project/a1-drafts/`
  (outside the tree) and are copied in only after the battery pidfile
  clears. Class: **operator-tooling** (prevented, not cured).

---

*Next entries append below as the round's tickets run.*
