# The Ostinato round's benchmark suite

> Methodology contract. Opened 2026-11-04 (Phase 0): the calibration
> canaries C1–C3 are defined and armed; every lane reports `null` ("not
> measured") in [RESULTS.md](RESULTS.md) until a per-run receipt exists
> under `receipts/`. Never a guess.

One-line purpose: the measurement lanes for the Ostinato round — A2
calibration canaries plus the app's hardening lanes, with committed
receipts.

- Owner: the A1 operator (the suite contract); runs are dispatched and
  receipted, never hand-written
- Registered in [../RESULTS.md](../RESULTS.md); does **not** feed the
  landing figures (the six-track contract stands — no `TRACKS` entry in
  `scripts/landing_benchmarks.mjs`)

**Mini-TOC**

- [Methodology](#methodology)
- [Calibration canaries](#calibration-canaries)
- [App lanes](#app-lanes)
- [Receipt shape](#receipt-shape)
- [Run commands](#run-commands)

## Methodology

The repo's standing benchmark laws apply verbatim (see
[../README.md](../README.md)): pin everything (task text, model id,
dates, seeds); anti-tamper scoring — acceptance material never enters the
agent workspace during a session, tests are read-only and
pristine-restored before scoring; receipts are per-case JSONL plus
`summary.json`, and `RESULTS.md` is written only from receipts; pair
accuracy with cost/latency; never mix pass@1 and pass@2 in one table;
**no self-grading** — every verdict comes from an external executable
verifier. Additions this suite: canaries score over N=3 trials (mean +
spread); canary prompt variants rotate per run (a cheap holdout against
prompt-memorization); all model traffic routes through the bundled
llm-bridge on :3031 with the stack up.

## Calibration canaries

| ID | Task (pinned) | External verifier | Metrics |
|---|---|---|---|
| C1 | Trivial: `Reply with exactly: UNOWN_OK` | stdout equals `UNOWN_OK` AND exit code 0 | wall time; usage tokens (bridge usage log) |
| C2 | Small-code: A2 authors a pinned pure TypeScript module + its unit tests in a scratch dir (task text pinned at dispatch, variant-rotated) | `bun test` exit 0 in the scratch dir + file-existence checks | `num_turns` (print-mode JSON envelope), wall time, tokens in/out |
| C3 | Debug: A2 fixes a seeded-broken fixture (pinned, variant-rotated) | the fixture's tests flip red→green under `bun test` | same as C2 |

Canaries are A2-lane measurements (the agent's reliability on this
lineage), not model-tier claims; they dispatch through the operator's
daemonizer with the `--max-turns` cap and the print-mode exit contract
(0/1/2/3/4) as signals.

## App lanes

Armed as the app lands; each names its verifier in
[the PRD's hardening table](../../docs/ostinato-prd.md):

- **K-1** keyboard-only e2e — the create → review → export flow driven
  with keyboard events only; zero pointer events in the spec.
- **A-1** accessibility — axe `wcag2a` + `wcag2aa` clean, focus-order
  pins, `Esc` modal handling, no color-only cues.
- **O-1** offline boot — the coda-pwa runner pattern (installability
  inventory + offline/online boot timing, N=5).
- **R-1** crash-resume — SIGKILL mid-review; resume restores the queue
  and the scheduling invariants.
- **I-1** import/export round-trip — byte-stable export across boots.

## Receipt shape

`receipts/run-<ts>/summary.json` + per-case JSONL (tokens, durations,
turns, exit codes, verifier verdicts). Scratch (workdirs, dumps) is
regenerable and never committed.

## Run commands

Canaries dispatch through the operator lane (the round log's resume
instructions in `docs/ostinato-round-session.md`); app lanes run their
committed runners as those land (the coda-pwa `run-pwa-bench.mjs`
pattern). Until a runner exists, a lane has no number — `null`.
