# Settings-UX benchmark (benchmarks/settings-ux/)

The Settings Evolution round's measurement suite — the Phase-9 benchmark
that turns every settings-UX claim into a receipt. The round's charter
(docs/settings-evolution-session.md) requires BEFORE/AFTER/DELTA evidence
for: time-to-first-configuration, time-to-find, search success, coverage of
the six mission questions, risk-badge presence, and recovery-path
reachability — this suite measures exactly those, plus the S2 ledger's
regressions (the 32 pi-selector rows unreachable since the `/settings`
override, S2-1) as first-class task failures.

Not a landing-page feeding suite (the six-track contract in
`benchmarks/AGENTS.md` stands); the round's story ships through
`RESULTS.md` here, the session log and the changelog rail.

## Method — the honest limits, stated first

**Scripted-driver benchmark, not human-subject testing.** A fixed keystroke
script drives the real TUI in a real PTY (pyte is the emulator — pane text
== pixel truth). Wall-clock times therefore measure *machine + script*
latency, not human hesitation; they are comparable BEFORE vs AFTER on the
same script and hardware, and NOT comparable to human lab timings. Where a
human cost exists that a script cannot feel (a setting that is *impossible*
to reach, a claim that misdirects), the suite measures it structurally:
task outcome, step counts, search hit-rate, anchor coverage — and captures
the pane as the exhibit.

Every lane runs against a **scratch `UNOWN_HOME`** (seeded via `unown
doctor` or the real wizard) — the developer's real config is never touched.
The stack (bridge :3031, engine :3030) must be up: `bun run agent:start`.
Model traffic is real (Agnes via the bundled bridge) in BM-1's
first-reply phase; everything else is local UI driving with zero endpoint
spend.

## The lanes (BM-1..BM-7)

| Lane | Measures | Method | Success criterion |
|---|---|---|---|
| **BM-1** first-configuration | the five-minute test: wizard → doctor → verified first reply | pristine home; `unown setup` driven at the recommended defaults (bridge preset, default model, keep theme — 3 Enters), then `unown doctor`, then `unown -p "Reply with exactly: UNOWN_OK"` | total wall time < 300s AND reply correct |
| **BM-2** find-and-change | can a user FIND and CHANGE a setting through the hub | 5 reachable tasks (search → editor → change → save; disk + ledger verified) + 6 S2-1 probes (pi-selector settings searched on both hub surfaces; the miss IS the measurement) | reachable: changed + diskOk + ledgerOk; probes: unreachable confirmed |
| **BM-3** search success | does search find the INTENT target | 12 pinned queries through the hub Search row; hit = target in the TOP-3 rendered results (a fuzzy false-positive is not a find) | hit-rate; 8 catalogued targets + 4 known-gap queries pinned for M3/M4 to flip |
| **BM-4** depth-to-setting | the IA's mechanical depth + coverage | browse-only Down-count from hub root to item editor, one row per section; registry coverage from the BM-7 audit | mean depth reported; coverage = settable/registry and the pi-unreachable count |
| **BM-5** recovery paths | can a user get back | change→Recently changed→revert round-trip (value restored on disk); drift diff; kill-switch row; dream-rollback row; scoped reset with backup on disk | 5/5 paths |
| **BM-6** six-questions coverage | the mission questions answerable from `/settings` alone | each question mapped to its section(s) with pinned anchors; covered = every anchor on the pane | 6/6 questions |
| **BM-7** trust gates | risk badges + typed confirmation + the ledger | (a) `audit-registry.mjs`: the registry read from the real module — integrity, field completeness (name/summary/help/risk), every settable item names its persistence; the pi-selector cross-check (machine count of unreachable rows) (b) PTY probe on the one settable high-risk item: gate shown, wrong phrase cancels with nothing written, "yes" writes + ledger entry | audit ok AND gate full cycle |

### The pinned workload

`tasks/bm2-find-change.json` (task values and disk expectations),
`tasks/bm3-search-queries.json` (queries + intent targets + the honest
`expectedAtBefore`), `tasks/bm4-bm6-map.json` (the depth sample and the
six-question anchor map). The workload is pinned separately from the runner
so an AFTER run measures the same tasks; changing a task file invalidates
comparison and must be recorded in `RESULTS.md`.

### Anti-tamper

- The registry is audited through the **real vendored module**
  (`SETTINGS_REGISTRY` imported by `audit-registry.mjs`), never a regex
  over our own source.
- The pi-selector cross-check counts `id:` entries of the vendored
  `settings-selector.ts` with the dialog-chrome exclusion list pinned and
  justified in the script header (the classification was verified against
  the source: `apply`/`single-mode` are picker buttons; `light-theme`/
  `dark-theme`/`warnings`/`model-thinking`/`anthropic-extra-usage` are
  real rows).
- TUI assertions are pane-truth (pyte); disk assertions read the scratch
  home's real files; the ledger is read from `settings-history.jsonl`.
- Receipts are written incrementally per lane — a crash loses nothing
  already measured, and `--only bm3` re-runs a single lane.

## Run

```bash
bun run agent:start   # stack up (bridge :3031)
pip install pyte pexpect pillow   # the PTY lane deps

python3 benchmarks/settings-ux/run-settings-ux-bench.py \
    [--run-dir receipts/run-<ts>] [--only bm1,bm2,...] [--skip-live]
```

Receipt shape: `receipts/run-<ts>/bm{1..7}-*.json` (per-lane, per-task rows
with outcomes, timings, input counts, disk/ledger booleans),
`bm7-audit.json` (the registry dump), `bm*.pane.txt` (the pane exhibits),
`summary.json` (the headline table). `RESULTS.md` is hand-written from the
receipts (the house rule — never the other way round).

Lane order on a full run: bm7 first (its audit feeds bm4's coverage block),
then bm1..bm6. A full run takes ~20–40 minutes on the round's sandbox.

## Known-method notes

- BM-1's first-reply benefits from the bridge's prefix cache when the exact
  pinned prompt has been served before — both BEFORE and AFTER runs share
  this condition, so the comparison stands; the absolute number is a floor.
- BM-2's search-first strategy is the hub's own advertised find surface
  (the Search row is the first menu entry); BM-4 measures the browse path
  separately, so neither strategy's cost hides behind the other.
- BM-3's "top-3" cut mirrors how a user scans a result list; the full
  top-10 rows are kept in the receipt for auditability.
- The wizard's own text is captured as evidence: BM-1 records whether the
  theme step still tells users `/settings` switches themes (true at BEFORE
  — S2-1's most user-visible symptom).
