# The Vivace round — validation log (V-1..V-4) + canary calibration evidence

One-line purpose: the Vivace round's failure ledger — every entry dated,
classified per §3 (probe / pin / rerun / flake-vs-gap / score-over-trials /
holdout / adapt), and disposed with its receipt.

## The ledger

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | First headless dispatch hung >260 s with the task COMPLETE (hello.py written, 3 bridge requests, 0 errors — session log proves finish at +4 s) (2026-11-05, bring-up) | harness/infra (NOT an A2 gap) | Root-caused to `readPipedStdin()` (`pi-repo/packages/coding-agent/src/main.ts:78-95`): non-TTY stdin is read to EOF, so an open idle stdin pipe blocks exit — standard CLI behavior (same as `claude -p`). Cure: every dispatch runs with `< /dev/null`. Root AGENTS.md already carried this rule; the operator had not read it before dispatch #1 — logged as the reading-order lesson |
| V-2 | The C3 canary's first launch died on a redirect race (`/bin/bash: c3-envelope.json: No such file or directory`) — the operator's one-liner backgrounded the mkdir away from C3's redirect; C2's first (successful) attempt then ran on a fixture the failed launch had NOT dirtied, but the RETRY ran on the fixed fixture and reported "already passing" | operator harness bug + fixture-pin violation (§3.2) | Fixed the rig: `run-canaries.sh` wipes + re-copies fixtures per canary per attempt (`rm -rf` + `cp` from frozen `fixtures/`). Lesson codified: no fixture reuse across attempts; the retry's envelope is quarantined, the first attempt's session jsonl is the honest receipt |
| V-3 | C3 calibration: correct content (4 TODOs, 3 files, `delegated:true`, real `task`-tool spawn to the `explore` agent) but the final answer wrapped the JSON in prose ("Reporting: - total_todos: 4…") → `--output-schema` gate fired, exit 3, `schema_valid:false` (2026-11-05) | prompt-brittleness (model class, not an Unown gap) | The envelope's exit-3 signal worked exactly as designed. Brief-side fix: schema lanes add "Reply with ONLY the raw JSON object — no prose, no code fences" (calibrated: see the C3 receipt). Queued as hypothesis H-12 (a `schema-strict-final` review-check/command lane) if the class recurs on real tickets. NOT a §5 benchmark conversion — the verifier (exit 3) already catches it deterministically |
| V-4 | `bun test` writes its pass/fail summary to STDERR (stdout carries only the version banner) — the C2 verifier's `2>/dev/null` pipe silently dropped the summary and false-FAILED a passing run (2026-11-05, rig bring-up) | operator harness bug | Fixed in the rig (`2>&1`); recorded because every future verifier that greps bun test output must know this. Two verifier bugs (V-2 race, V-4 stderr) found before any app ticket — the rig-first law paying for itself |
| V-5 | The full unit suite on `18e4a98a`: encore finale h2 test (`encore.test.tsx:817`) fails **deterministically in-suite** (4/4) in this 2-core container — bun 1.4.3 AND 1.4.4, with and without the changelog-data revert — while passing isolated (1.98 ms) and with sibling files; GitHub CI "Build + test (ubuntu-latest)" is **success on the same commit** (check-runs receipt, 2026-11-05) | environment-sensitive test-isolation defect (B-17; genuine-gap class for the repo's test hygiene, NOT a Vivace-vehicle blocker) | Registered as B-17; fix ticket **VH-1** queued (through A2: cleanup-between-files / shared-happy-dom hygiene in the encore lane). The operator's first battery draft claimed "ALL GREEN" from the prior lineage's older-tree receipt — corrected to measured numbers before commit (receipt-overclaim caught at the operator's own gate) |

## V-5 evidence — the B-17 attribution matrix

| Experiment (all on tree `18e4a98a`, 2026-11-05) | Result |
|---|---|
| Full suite, bun 1.4.4 | FAIL (encore finale h2) — 4/4 runs |
| Full suite, bun 1.4.3 (second binary) | FAIL (same test) |
| Full suite, changelog-data.ts reverted to `f3f0176e` | FAIL (same test) — changelog-data excluded |
| `encore.test.tsx` isolated | **PASS** (1.98 ms) |
| `encore.test.tsx` + landing siblings (creature/coda) | **PASS** |
| GitHub CI "Build + test (ubuntu-latest)" on `18e4a98a` | **success** (check-runs API receipt) |

Verdict: cross-file interference that only bites under this container's
constrained CPU profile — the CI runner's profile does not reproduce it.
The defect is real for anyone running the suite on a small machine; the
fix lane (VH-1) is test hygiene, not product code.

## Canary calibration receipts (2026-11-05, tree `18e4a98a`, bun 1.4.4, agnes-3.0-flash via zai-bridge)

All runs: `--output-format json < /dev/null`, fresh session per run,
fixtures frozen under `fixtures/` and reset per attempt by
[`run-canaries.sh`](run-canaries.sh). The rig's own green run (the
verifiable receipt): `C1 PASS · C2 PASS · C3 SCHEMA-FAIL` at stamp
`20261105T202532Z`.

### C1 — trivial codegen + run (provider-chain + tool-use smoke)

- Brief: "Create a file hello.py that prints the result of 2+2, run it with
  python3, and report the exact output you saw."
- Result: **PASS** — `hello.py` created (`print(2 + 2)`), executed, "4"
  reported verbatim. Envelope: `subtype:"success"`, 3-4 turns, 4.1-5.4 s
  wall, `cost_usd: 0`.
- Turns profile: bash(create) → bash(run) → text(answer). No rework, no
  clarification, no drift outside scope.

### C2 — test-fix loop (minimal diff + external verification)

- Brief: "The file sum.test.ts is failing. Fix the code so all tests pass
  WITHOUT editing the test file. Quote the exact bun test output."
- Result: **PASS** — tool trace: `bash(ls; bun test)` → `read(sum.ts)` →
  `edit` (exactly one hunk: `return a - b; // BUG…` → `return a + b;`) →
  `bash(bun test)` → honest before/after receipt quoting both outputs.
  Test file byte-identical to the frozen fixture after the run
  (`git diff --no-index` clean). This is the verify-before-done contract
  executing correctly with zero operator intervention.
- The "already passing" envelope from the V-2 retry (the second run on
  the dirty fixture, session `01a1ad5d-9a07…`) was lost in the rig's own
  cleanup glob — its substance is preserved in this log and in the
  session jsonl under `~/.unown/agent/sessions/` (outside the repo); it
  is the pin-violation artifact, not a capability receipt. The honest C2
  capability receipt is the FIRST attempt's trace above (session
  `01a1ad5d-4bd8…`, four tool calls, one-hunk edit).

### C3 — delegation + structured output (task tool + `--output-schema`)

- Brief: "Use the task tool (subagent delegation) to count the TOTAL number
  of TODO comment lines across all .ts files in the current directory. Do
  not count them yourself — delegate the counting. Then report: total_todos,
  files_with_todos (filenames), delegated (true if the task tool was used)."
- Result: **content PASS, schema FAIL (exit 3)** — the trace shows a real
  `task` call to the `explore` agent (headless delegation works); the
  reported counts are correct (4 TODOs across alpha.ts/beta.ts/gamma.ts);
  `delegated: true`. But the final text wrapped the JSON in prose →
  `schema_valid:false`, exit 3. 19.8 s, 2 turns.
- Calibration takeaway: agnes-3.0-flash honors the schema gate's failure
  signal but does not self-format bare JSON unless told. Envelope metrics
  and the failure text are preserved in `sessions/c3-envelope-*.json`.

### Baseline numbers (the Phase-1 form)

| Canary | Pass | Turns (typ) | Wall (typ) | Exit |
|---|---|---|---|---|
| C1 codegen+run | yes | 3-4 | 4-5 s | 0 |
| C2 test-fix | yes | 4 | ~6 s | 0 |
| C3 delegate+schema | content yes / schema no | 2 | ~20 s | 3 |

These three are the round's repeatable baseline: any augmentation that
claims to improve driving (briefs, skills, hooks) re-runs this rig and
reports the delta. C3's schema lane is the round's first measured
improvement target (H-12's metric: C3 exit 3 → exit 0 with the SAME brief,
verified over ≥3 runs).

## The pin register (per §3.2, every dispatch)

- Unown: `v0.0.56` @ `18e4a98a` (clone of `main` 2026-11-05)
- Runtime: bun 1.4.4 (npm-global; the prior lineages pinned 1.4.3 for
  bun#46510 — this lineage's battery ran green on 1.4.4, receipted in the
  round log; if any lane goes red, repin 1.4.3 before diagnosing)
- Model: `zai-bridge/agnes-3.0-flash` (bridge → `https://apihub.agnes-ai.com/v1`)
- Effort: default (none pinned — the model lane carries no effort knob today)
- Environment: fresh `~/.unown` home (default; the prior convention of a
  project-local `unown-home` is a logged drift — both shapes are supported),
  `.env` from `.env.example` with the Agnes key
