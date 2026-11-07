# The Serenade round session log

> The A1 operator's checkpoint journal for the Serenade round — a fresh
> directive (**DRIVE A2 × AUGMENT A2 × PROVE IT**, 2026-11-07), the
> thirty-second lineage on this repo. Vehicle: **Legato** (per the
> §0.9.5 fallback; [the selection receipt](../benchmarks/serenade-round/README.md)).
> Every checkpoint below was lived, not reconstructed.

## Phase 0 — recon, canaries, selection (2026-11-07)

**Bring-up on a fresh clone** (`unown-work/unown`, the thirty-second
lineage's tree):

- bun **1.4.3** installed to `~/.bun` (the container's 1.3.14 cannot
  parse the pi-repo 1.4 lockfile — `UnknownLockfileVersion`; the
  toolchain-restore lane applies). Root `bun install --frozen-lockfile`
  400 pkgs; pi-repo 340 pkgs; `hydrate:model-data` (the build:offline
  gate demands it — models.dev catalog: 400 openrouter, 303 vercel-ai-
  gateway, …); full `npm run build:offline` chain green.
- Stack up via `bun run agent:start`: bridge `:3031` upstream **200**
  (6 agnes models discovered live), engine `:3030` ready v0.0.57 @ the
  checkout HEAD, 9 router jobs, breaker closed; `unown doctor` →
  **"unown is ready to chat"** (the honest ⚠ pair: LSP-servers
  container gap + the first-session model-spec heal).
- `.env` bootstrapped from `.env.example` with `BRIDGE_UPSTREAM_KEY`
  set (Agnes AI); PAT wired into the push remote URL per the house
  pattern; `unown` linked onto `~/.local/bin`.
- **The V-1 stdin law re-learned the honest way**: one manual
  `unown -p` run with an inherited pipe never exited (killed at 300 s;
  the bridge receipt shows the answer had flushed in 919 ms). The rig's
  `< /dev/null` is load-bearing. Logged as a W1-class observation, not
  a new defect — the law was on file.
- **The stale-clone catch**: the first unit battery showed 2 fails
  (landing composition 14-vs-15 bands) — fetch revealed the Sonata
  round-close trio (`4fa89232` the F-10 ripple cure, `123a861c` the
  FUGUE QUEUE COMPLETE checkpoint, `6e3579bb` the memory renders)
  landed 15 minutes before this lineage's clone. Fast-forwarded;
  battery re-run **2654/0/208** — matching the round-close receipt
  exactly. The bring-up never dispatched against a stale tree.
- **V-38 pin re-applied** to the fresh home (models.json 2 +
  model-specs.json 1 → 4096) before any dispatch; the operator lane
  rebuilt at `/home/z/my-project/.a1/` (a1-dispatch.py, a1-continue.py,
  v38-pin.py — the in-repo `scripts/a1/` copies, laws intact).

**Canaries (the frozen vivace rig, stamp 20261107T184451Z):**

- **C1 PASS** (codegen+run: hello.py output 4, 3 turns).
- **C2 PASS** (test-fix: minimal diff, test file untouched).
- **C3 SCHEMA-FAIL rc=3** — the known V-3 prose-wrapped class, counts
  correct in the result text (the standing measured target; the cure
  belongs to the round's augment lane if it fires ≥2×).
- **C4 PASS through the real dispatch harness**: 2 dispatches /
  **10+7 turns** — the first chunk capped (exit 5, the V-12 gate),
  `a1-continue.py` raised the cap to 20 (V-5a cumulative law), the
  continuation landed DONE; operator-verified: `fizzbuzz.py` lines
  3/5/7/15 = Fizz/Buzz/7/FizzBuzz, `fizzbuzz.test.py` 4/4 tests OK.
  (The `-m unittest fizzbuzz.test` dotted-module wrinkle was the
  BRIEF's filename ask — A2 reported the resolution honestly and made
  the direct-run form work. Brief-quality lesson logged.)

**§0.9 selection executed** ([the receipt](../benchmarks/serenade-round/README.md)):
**Legato SELECTED** (E×G×V 8 at full tractability — the pre-registered
fallback; hostile-page ingestion W5 + the 12-ticket schema-retention
test W7 + the weeks-scale reading queue W8 + the W9 gate-discipline
pressure, none of which any prior vehicle drove as its default path).
Parked: the Tauri shell (tractability 0), the memory-app sibling
(overlap with the just-closed Fugue surface), the gallery SaaS
(rehearsed shape). The Sonata teardown duties (GT refresh, matrix
refresh, competition cycle, registry gates, validation-report refresh,
evidence packet) are absorbed as THIS round's Phase 2/3.

**Baseline frozen**: typecheck 0 · unit 2654/0/208 · canaries as
above · snapshot at
[serenade-baseline-2026-11-07.json](../benchmarks/serenade-round/snapshots/serenade-baseline-2026-11-07.json).

**Next: L-1** (the Legato scaffold, ticket 1 of the pre-written
V-1..V-12 queue), dispatched through A2 per the standing brief shape.
