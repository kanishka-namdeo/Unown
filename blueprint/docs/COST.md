# Cost model — staying under $50/month

Unown's recurring spend is dominated by *scheduled* headless calls, so the
design caps both their frequency and their input size. Interactive use is
your own subscription/API budget and not counted here.

## Assumptions

| Model role | Rate used (public list, round) | Used by |
|------------|-------------------------------|---------|
| Small/fast (Haiku-class) | ~$1 / M input · ~$5 / M output | nightly dreamer |
| Mid (Sonnet-class) | ~$3 / M input · ~$15 / M output | harness analyst + routed reviews |

## Scheduled jobs (the real bill)

| Job | Frequency | Calls/run | Est. tokens/call | Est. cost/month |
|-----|-----------|-----------|------------------|-----------------|
| `nightly-dream` | 30×/mo | 1 Haiku call | 25K in / 2K out | **≈ $1.05** |
| `self-improve` (live) | 4×/mo | ≤ 6 Sonnet calls (iterate cap) | 8K in / 1K out each | **≈ $0.70** |
| `event-router` | label-gated | 1 Sonnet per accepted event | 6K in / 0.8K out | ≈ $0.10–0.20 per event |
| Session notes/hooks/scribe | — | local-only | 0 API tokens | $0 |

**Typical total: well under $10/month at the default schedule.** A busy repo
taking ~50 routed events a month adds roughly another $10 — still under half
the budget.

## Knobs (in order of leverage)

1. **`DREAM_MAX_NOTES`** (dream.py env) — biggest input lever; halving notes
   roughly halves dream input tokens.
2. **Schedule frequency** — dreams daily → every other day halves that line.
   In `.github/workflows/*.yml`, edit the `cron:` entries.
3. **`iterate.sh --max-iterations`** — bounds how many mine→propose→validate
   rounds the improvement loop may attempt per run.
4. **Label gating** in `event-router.yml` (`unown` label) stops strangers from
   spending your tokens.
5. **Offline mode everywhere** — `--offline`, seed_demo, and the workflows'
   offline inputs run the entire machinery with **zero** API calls; go live
   only when you need model-refined output.

## Safety valves

- No wallet-driven recursion exists anywhere: the improvement loop cannot
  spawn more loops; workflows use `concurrency` groups and `timeout-minutes`.
- CI runs without secrets degrade to dry-run prints instead of failing loudly
  into retries.

## A note on estimates

Rates drift and yours may differ (cached input, subscriptions via Claude Code
login instead of pay-as-you-go). Re-check once after your first month of
`Actions` history — but with these defaults you would need ~250 routed events
or a 40× token blowup to threaten the $50 ceiling.
