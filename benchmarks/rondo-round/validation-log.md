# The Rondo round — validation log

One-line purpose: the failure → benchmark reflex ledger for the Rondo
round — every meaningful failure with its class, root cause, repro and
disposition; the bug register and ticket queue live in
[the round log](../../docs/rondo-round-session.md).

## Entries

| ID | Event (dated) | Class | Root cause | Disposition |
|---|---|---|---|---|
| V-1 | The opening C1 smoke attempt (`unown -p "Reply with exactly: UNOWN_OK"`, 2026-11-06 ~19:57 UTC) hung past a 300 s guard. Session transcript `01a1ad49-42d7-7a48-afef-08e1eca13f7c` (7 lines): the answer WAS produced — `UNOWN_OK`, stop, 2 model calls (13.9 s + 2.7 s, both `status:"ok"` in the usage log) — but the process never exited; the harness's own wrapper lines (`__workspace_agent_exit_code=$?` …) appear inside the user message | prompt-brittleness (operator-harness class) | The `-p` run inherited the dispatch shell's stdin stream and slurped the script tail into its prompt; the exit then never completed under the open pipe. NOT filed as issue #30: the answer-vs-exit signature differs and the stdin confound fully explains it — but the differentiation itself is the receipt | Cure applied: stdin guarded (`< /dev/null` inline; `stdio: ["ignore", …]` in spawned runners — the polyglot runner's standing pattern). C1 green ×2 after the cure (2 s / 4 s, exit 0). The stdin-guard law enters the operator runbook (round log, operator decisions). The genuine #30 capture stays armed (ticket A2H-7) |
| V-2 | Sandbox recycle reclaimed the off-repo `.a1/` operator workspace, `unown-home/`, the npm-global bun pin (a stale `/usr/local/bin/bun` 1.3.14 below the ≥1.4 floor), fd, the pip venv and the playwright cache (2026-11-06, bring-up) | infra-flake (the known recycle class — fourth receipted occurrence across lineages) | The sandbox persists only `/home/z/my-project/` contents; tooling outside it is reclaimed | Cured in one pass from the bring-up checklist: bun 1.4.3 re-pinned, fd 10.5.1 (drift from 10.2.0 noted, verified working), chromium_headless_shell-1248, venv rebuilt, install 7/7, `.env` Agnes lane, stack up. The daemonizer + battery runner + canary scaffolding recreated as durable scripts under `.a1/scripts/` — the next recycle's cure is two script invocations, not archaeology |
| V-3 | The baseline battery's `check:docs` gate redded mid-run (exit 1) on a tree the prior lineage receipted green | operator-procedure (measurement isolation) | The battery ran while the operator was writing the round's own new docs into the tree — the gate correctly flagged the new pages' links to `benchmarks/rondo-round/README.md`, which did not exist yet (created minutes later) | Not a product defect. Cure: the round docs landed before the commit; `check:docs` green post-landing. Law: no tree writes during a battery run — the battery is receipted on a frozen tree or re-run |
| V-4 | The baseline battery's unit lane: 2257 pass / 1 fail / 161 files at `18e4a98a` (2026-11-06 20:08 UTC) — the Etude baseline was 2235/0/160, the count grew with the parallel lineage's R-2 landing, but one test went red | pending classification (rerun in flight at receipt time) | The first battery's `tail` capture cut the failing test's name; a full-capture rerun was dispatched immediately | See the entry update below — classification and disposition recorded when the rerun lands |

## Update — V-4 classification (2026-11-06, the reconciling lineage)

(Recorded when the full-capture rerun completes; the entry is never
quietly rewritten — the update is appended, dated.)

The opening lineage's in-flight rerun never committed its result (the
session ended); the reconciling lineage re-ran the battery with full
capture on `7f615d84` (and once on `18e4a98a`-based trees before the
rebase — same verdict). Classification:

- **The failing test**: `Finale — the program's success question + live
  answer (plan §5.7) > renders the success question as an h2 +
  blockquote` — `src/components/encore/__tests__/encore.test.tsx:817`, a
  testing-library `getByRole("heading", { level: 2 })` query failing on
  an otherwise-rendered Finale tree (the full HTML dump is in the
  battery capture).
- **The differential**: the file standalone is **55/0 green (×2)**; the
  full battery is **2257/1 red (×3: the opening lineage's run + two on
  the reconciled tree)** — a deterministic **cross-file test-isolation
  defect** (bun test runs all files in one process; something an earlier
  file does globally breaks the Finale h2's role discoverability).
- **Class**: genuine-gap (test isolation — the pre-existing encore
  Finale drift, NOT a Rondo-round regression; the Etude baseline's
  2235/0 predates the polluting landing).
- **Ticket**: **A2H-9** — queued with its dispatch brief in
  [the round log](../../docs/rondo-round-session.md); the fix must land
  at the polluting layer with the assertions unweakened.
- **Evidence**: the full battery capture lives operator-side
  (`.a1/tickets/logs/v4-rerun.log`, 3183 lines — the failure block at
  lines 2185-2235); the in-repo receipt (`.unown/receipts/a2h9.md`,
  tree-verified into `receipts/` at close) carries the root-cause chain.
