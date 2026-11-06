# The Scherzo round — session log (2026-11-07, OPENED by the twenty-sixth lineage)

A FRESH A1 directive — **DRIVE A2 × AUGMENT A2 × PROVE IT** (a new task,
not a resumption; the Rondo round is CLOSED and nothing of it is reopened
here). The dual deliverable stands: an app shipped THROUGH A2, and the
evidence that driving A2 improved while doing it.

- **Round vehicle**: **Bolero** — a recipe-driven website watchdog
  ([the PRD](bolero-prd.md), APPROVED with the pre-registered
  [§0.9 selection receipt](../benchmarks/scherzo-round/README.md))
- **Baseline**: ALL GREEN 11 lanes on the pristine tree `ae8a73db`
  ([the receipt](../benchmarks/scherzo-round/README.md#1-baseline-battery-the-pristine-tree-2026-11-07))
- **Operator lane**: `.a1/` off-repo (rebuilt this lineage) + durable
  in-repo mirrors `scripts/a1/` + `scripts/a1-continue.py`

## Mission state

| Track | Status |
|---|---|
| Phase 0 (recon refresh, canaries, selection, PRD, baseline) | ✅ COMPLETE (this lineage) |
| DRIVE (S-0..S-10) | **S-0..S-5 CLOSED** (plan, domain+pins, runner+real-browser e2e, server+health, scheduler, dashboard PWA) — S-6 (deploy+supervision) is next |
| AUGMENT (H-12 gate re-run, H-10 re-activation, H-16 build, H-18/H-19 seeds) | H-12 rebuilt + committed (the mandated first act) + **10 zero-correction continuation data points** (S-5's main run added five more; the polish run exercised the V-15 pin-cure path); V-5 held (no spirals on S-5 — 79 scope turns, 0 spiral turns); V-6 filed (the e2e isolation law); the rest queued |
| PROVE (§8 evidence pack, RESULTS.md) | receipts s0..s5 committed; turns-to-done trend recorded (20 → 21 → 32 → 25 → 24 → 79-scope) |

**Drive receipts so far** (all through A2, all operator-gated):

| Ticket | Turns / dispatches | Gate |
|---|---|---|
| S-0 PLAN.md (491 lines, 14 edges) | 20 / 2 | PASS (sections + rows verified) |
| S-1 domain core + round-trip pins | 21 / 3 | PASS (9/0/50, planted-drift RED) |
| S-2 runner + real-browser e2e | 32 / 5 | PASS (22/0/84 unit; e2e 1/0 real Chromium) |
| S-3 server + ingest + health | 25 / 4 | PASS (33/0/135; /health live-curled) |
| S-4 scheduler (mechanism handed down) | 24 / 3 | PASS (39/0/150 ×2 consecutive) |
| S-5 dashboard PWA (+polish) | 79 / 9 | PASS (45/0/163 A + 49/0/188 B; e2e 2/0 real Chromium keyboard-only; precache 6 URLs 0 missing; the operator's live browser pass + 2 media captures) |

**Parallel engagement**: the twenty-seventh lineage opened the **Sonata
round** (vehicle Fugue, `apps/fugue/` — the engine/learning-loop surface,
non-overlapping with Bolero's browser/ops surface) mid-S-3; reconciled per
the ledger-arbiter law at both landings (rebase, disjoint surfaces,
merged-tree joint verification each time — bolero:test green on every
merged tree). The two rounds coexist on `main` under the non-overlap
contract they receipted.

## Operator decisions (2026-11-07)

1. **Round name**: Scherzo (unclaimed — `git grep -il scherzo` = 0 hits
   at open). **Vehicle name**: Bolero (0 hits).
2. **Vehicle**: Bolero over Crescendo/Harmony/Legato/Tempo — scored
   2×2×2 (the full table in the selection receipt). Crescendo is the
   declared carry-over if §0.9.5 re-scopes.
3. **Push lane**: direct to `main` per the standing operator decision
   (2026-11-02), with the parallel-round discipline (fetch + rebase
   before every push; a rejected push is a fetch, never a force).
4. **Homes**: `UNOWN_HOME=/home/z/my-project/unown-home` (the documented
   override), pinned on BOTH homes per this round's V-2.
5. **The H-12 mandate executed**: `scripts/a1-continue.py` committed
   in-repo (the Rondo closeout's "next round's first act") — the
   promotion gate re-runs on this round's first genuine capped chunk.
6. **Budget note**: engine governor limits stand at 60 calls/h /
   200k tok/h; raise `PI_ENGINE_MAX_TOKENS_HOUR` only on a receipted
   throttle (the V-17 precedent).

## Environment checkpoint (2026-11-07, the twenty-sixth lineage — the bring-up)

- Fresh sandbox lineage; clone @ `ae8a73db` (= `origin/main`, v0.0.57)
  at `/home/z/my-project/unown`. bun **1.4.3** at `~/.bun/bin` (the
  sandbox ships 1.3.14 at `/usr/local/bin` — the standing pin).
- `bun run agent:install` 7/7 (engine systemd service skipped — no user
  bus in the container, the known shape; the agent-side auto-start
  fallback carries it). fd 10.2.0 (`.deb` extract lane), chromium-1248
  via the repo binary (`node_modules/.bin/playwright install chromium`
  — the chromium-1200 trap cured at bring-up), venv present.
- `.env`: the Agnes lane (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  key set, `BRIDGE_MODEL=agnes-3.0-flash`),
  `UNOWN_HOME=/home/z/my-project/unown-home`. **V-38 pre-seed applied
  BEFORE the first dispatch** (maxTokens 4096, both homes, operator-pin
  provenance).
- Stack: bridge `:3031` (upstream 200), engine `:3030` (v0.0.57 @ HEAD,
  phase ready, 9 jobs, breaker closed, bwrap active). Mortal across
  recycles — re-run `python3 /home/z/my-project/.a1/scripts/dispatch-bg.py
  stack --cwd /home/z/my-project/unown`.
- Operator toolchain rebuilt (the V-2 recycle class, ~11th rebuild):
  `dispatch-bg.py` (daemonizer), `a1-dispatch.py` (H-11: stdin guard,
  V-38 ride-along, V-39 sanitizer, envelope gates), `battery.sh`
  (11 lanes), `v38-pin.py` (both homes), `a1-continue.py` (H-12, now
  canonical in-repo). Mirrors: `scripts/a1/`.
- Canaries: C1 ×2 green · C2 doctor 19✓/2⚠ · C3 engine UP · C4 real
  dispatch 3 turns / 4/4 tests / tree-verified.
- Credentials: PAT + Agnes key at `/home/z/my-project/.secrets/`
  (git-credential store lane; never in `.git/config`, never in briefs).

## The round's validation log

Lives at [benchmarks/scherzo-round/validation-log.md](../benchmarks/scherzo-round/validation-log.md)
(V-1..V-4 filed at open — all operator-tooling class, honest).

## Ticket queue (the DRIVE roadmap; coverage-mapped)

| # | Lane | Status |
|---|---|---|
| S-0 PLAN.md (491 lines, 14 edges) | Planning | ✅ |
| S-1 domain core + frozen grammar + round-trip pins | Engineering | ✅ |
| S-2 runner v1 (fixture-first) | Engineering | ✅ |
| S-3 server + SQLite + ingest API + health | Architecture/Eng | ✅ |
| S-4 scheduler (bounded real-clock) | Engineering | ✅ |
| S-5 dashboard PWA | Engineering | **CLOSED** (receipt s5.md) |
| S-6 deploy + supervision + CI lane | Operations | 🔜 next |
| S-7 resilience battery | Quality | queued |
| S-8 e2e + a11y battery | Quality | queued |
| S-9 docs + landing + README + blog | Collaboration | queued |
| S-10 closeout (§6c receipts, §8 pack, RESULTS) | Learning/Close | queued |

AUGMENT queue: H-12 promotion gate re-run (first genuine capped chunk) ·
H-10 promote-or-retire (real firing surface) · H-16 build + gate ·
H-18/H-19 PROPOSE rows (this round's seeds).

## Dispatch briefs

### S-0 — the PLAN ticket (the standing brief)

Rides `a1-dispatch.py --name s0 --cwd /home/z/my-project/unown
--max-turns 8` (chunks ≤8 turns; continuation via
`scripts/a1-continue.py`); the brief text lives in the round log's
dispatch ledger at `/home/z/my-project/tickets/scherzo/` (mirrored
receipts) — the PROMPT ECONOMY header + the C-0 pattern (read-only
research, then `apps/bolero/PLAN.md` with the architecture, the frozen
grammar draft, the ticket map, and the edge-case register; acceptance =
operator gate: P0 items complete, edge cases mapped, none orphaned).

## Resume instructions (for the next lineage)

1. Re-clone or ff-only pull `origin/main`; verify HEAD matches this
   log's last receipted SHA; re-read this log + `A2_GROUND_TRUTH.md`
   + the registry. `git fetch` + rebase BEFORE every push.
2. Bring-up (the one-pass cure): bun 1.4.3 → `~/.bun/bin`; fd 10.2.0
   (.deb extract); `node_modules/.bin/playwright install chromium`
   (1248, never `bunx playwright install` — the 1200 trap);
   `bun run agent:install`; `.env` Agnes lane (key at `.secrets/env`);
   `python3 .a1/scripts/v38-pin.py` (BOTH homes) **before any
   dispatch**; stack via `python3 .a1/scripts/dispatch-bg.py stack
   --cwd /home/z/my-project/unown`; smoke `unown -p "Reply with
   exactly: UNOWN_OK" < /dev/null`.
3. The operator toolchain is IN-REPO now: if `.a1/scripts/` is missing,
   restore it from `scripts/a1/` + `scripts/a1-continue.py` (copy, chmod
   +x) — the V-2 recycle tax is one `cp` away.
4. Verify the checkpoint: doctor "ready to chat"; engine UP at HEAD;
   `battery.sh` if a baseline re-receipt is needed.
5. The queue stands above: S-0 first (the standing brief, this log);
   every dispatch rides `a1-dispatch.py`; every claim rides the
   evidence-with-claim law (first-chunk receipt pushed WITH the claim
   commit); the 30-min window is the FLOOR, 60-min extended grace when
   the claimant's lane is demonstrably active.
6. Standing laws carried from Rondo: stdin guard · V-38 pre-seed · V-39
   brief sanitizer (no literal termination-command text) · V-40
   split-write law (first write 60–80 lines, then edits; < ~3k
   tokens/turn) · V-5 cumulative max-turns (a1-continue computes the
   raised cap) · read subtype AND capped, read the RESULT TEXT (V-11
   preamble-stop) · the V-18 mechanism law (operator hands async
   designs down) · H-2 tree-verify at every gate · V-31 final-tree-only
   battery claims · no tree writes mid-battery (V-3/V-4).

## S-5 close notes (2026-11-07, the twenty-eighth lineage — the resume + S-5)

- **Resume**: HEAD ff-matched `origin/main` @ `536b2086` (no parallel
  drift); stack already warm — bridge :3031 (Agnes 200), engine :3030
  healthy, smoke UNOWN_OK, V-38 pinned, toolchain + secrets intact.
  Both unit lanes green on arrival (39/0/150 ×2).
- **The receipted throttle** (V-17 precedent exercised): the S-5 drive
  exhausted the 200k tok/h ceiling (engine status: 212037 tok/h,
  THROTTLED) → `PI_ENGINE_MAX_TOKENS_HOUR=400000` set in `.env` (the
  round's standing decision) + a stack restart — engine now UP @
  `536b2086` (the STALE advisory cured too), budget healthy.
- **S-5 CLOSED through A2** (receipt `benchmarks/scherzo-round/receipts/s5.md`):
  9 dispatches / 79 turns; the four surfaces + the PWA shell + the
  keyboard-only flow lane all operator-verified LIVE (real browser
  pass, media captured at `download/bolero-media/` for S-9's landing).
  Two gate-catches + one isolation defect cured through A2 (the
  polish ticket): %ZZ 500→404 (taxonomy), the real-digest seed
  (content-addressing honesty), the `BOLERO_DATA_DIR` e2e isolation
  seam (V-6 filed — the isolation law).
- **Gates on the final tree**: bolero:test 45/0/163 (Lane A) ·
  49/0/188 (Lane B) · bolero:e2e 2/0/18 (real Chromium, keyboard-only
  flow) · verify-precache "6 precache URLs, 0 missing — PASS".
- **Next**: S-6 (deploy + supervision + the public/bolero/ lane), then
  S-7/S-8 (batteries), S-9 (docs/landing — the captured media ride),
  S-10 closeout; AUGMENT queue unchanged (H-12 gate formal re-run,
  H-10 promote-or-retire, H-16 build, H-18/H-19 seeds).
