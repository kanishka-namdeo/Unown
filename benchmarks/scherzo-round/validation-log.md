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

## V-5 — the research spiral on reference-rich tickets (genuine-gap, A2 behavior)

- **What**: S-2 burned TWO full chunks (16 turns) reading references
  without writing a single file — the chunk-2 last words ("let me read
  the two remaining reference files, then start writing") repeated the
  chunk-1 pattern verbatim. The flash model's reference appetite on a
  rich tree (PLAN + frozen domain + the Chaconne runner + the house
  patterns) is unbounded under a turn cap: each chunk re-derives
  "one more file to read" and the write never starts.
- **Class**: genuine-gap (repeatable A2 behavior, not infra/prompt
  one-off) — this is H-17's exact predicted firing surface
  (conversation-pattern stuck detection), now with a receipt.
- **The §3.7 operator intervention (the V-18 mechanism law)**: the
  continuation carried a **write-now directive** — no reading except
  self-authored files + an exact file order (adapter → executor →
  report → fixtures → tests → e2e). Chunk 3 then landed 5 source files
  in 8 turns (the round's highest per-turn yield).
- **Cure (standing, this round)**: every continuation on a ticket whose
  chunk-1 produced no files carries the write-now pin by default. The
  H-17 detector's design gains its first acceptance case: "chunk
  boundary crossed with zero writes AND repeated read-intent in the
  last words" → flag for the operator.
- **Benchmark conversion**: the S-2 chunk-1/chunk-2 transcripts are the
  frozen negative example; a rerunnable check will ride H-17's gate
  design (detect-at-boundary, no false positive on legitimate research
  tickets — S-0/S-1 chunk-1s were research-only but chunk-2 wrote
  immediately; the discriminator is the SECOND boundary with zero
  writes).

---

*Next entries append below as the round's tickets run.*

## V-6 — the e2e's shared-data-dir assumption: an operator seed 422'd the next e2e boot (operator-tooling + test-isolation, cured in-ticket)

**When**: 2026-11-07, the S-5 polish run. **Class**: operator-tooling ×
test isolation (NOT a genuine A2 gap — the e2e's own header claimed "a
fresh SQLite store" while booting the shared `apps/bolero/data/` dir;
its finally-wipe only covers clean exits, so the operator's manual
live-pass seed (a legit real-user verification) polluted the next
boot — the UNIQUE constraint 422'd the e2e's own seed POST).

**Signal**: the polish continuation reported "seedRegistry … 422 …
register a watch" — a failure the operator could reproduce exactly
(one look at data/bolero.db explained it).

**Cure (handed down per V-18, landed through A2 in-ticket)**: the
1-line `BOLERO_DATA_DIR` env seam in boot.ts + the e2e boots on
mkdtemp + rm in finally — the e2e is hermetic now (proven: no data/
residue after the run; the shared dir is never touched). The two
polish companions: the %ZZ 500→404 taxonomy cure + the real-digest
seed (both operator gate-catches, both unit-pinned).

**Law carried forward**: an e2e that claims a fresh store must OWN its
freshness (temp dir), never borrow a shared path whose state another
actor (the operator, a crashed run) can change — the isolation law,
added to the playbook's e2e checklist.
