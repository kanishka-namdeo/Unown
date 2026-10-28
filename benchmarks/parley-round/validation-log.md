# The Parley round — the validation log

> The failure→root-cause→benchmark→improvement→rerun ledger, continuing the
> method inherited from the SOTA round
> ([its log](../sota-round/validation-log.md)): never patch around a failure;
> decide where the defect lives (Unown, the caller's environment, or the app
> under construction); fix it where it lives; create the regression or
> benchmark that would catch it; rerun the original workflow and record
> before/after evidence. An entry that ends in "no Unown defect" is a valid,
> wanted outcome — the log exists to make the process visible, not to
> manufacture fixes.

## Failures

### F3 — the headless build session died twice with a 0-byte result envelope (closed: Unown defect, fixed + pinned)

- **Description:** the UI phase's first two detached build sessions
  (`unown -p … --max-turns 40`, the F0/F2 launcher contract: stdin
  /dev/null, stdio to files, envelope polled from the log) both ended with
  the process gone, `out.log` at 0 bytes, and no JSON envelope — the
  unattended caller's entire result lost. The receipts stopped at the
  fleet-drain sentinel; the session transcript's last event was an assistant
  message with empty content.
- **Reproduction:** session receipts `…180025-x95c.jsonl` (59 tool calls,
  store.tsx written) and `…181703-edd6.jsonl` (35 tool calls, store tests
  mid-flight); the bridge usage log shows the trigger for each death —
  consecutive upstream faults: two 200 streams with ZERO completion content
  (`p=0 c=0 ms=2550` at 18:03:03; `p=0 c=0 ms=3751` + `p=0 c=0 ms=9033` at
  18:19:40/44), the bridge's degenerate-stream guard firing on both
  (`degenerate: 2`, retry log lines) with the retries dying to
  `stream ended early: Controller is already closed`, and pi-ai's
  client-side empty-completion retry exhausting on the second consecutive
  fault. A controlled foreground re-run of the same resume completed
  normally — the failure requires the upstream fault, not a deterministic
  CLI bug.
- **Root cause (two layers):**
  1. *Trigger — upstream:* the Agnes flash endpoint returned 200 streams
     with zero work product twice in a row (the documented 2026-10-23 fault
     family, previously measured under concurrent load). All three designed
     guard layers fired as built: the bridge's degenerate-stream holdback
     (retry once), pi-ai's empty-completion throw (one full request retry),
     and cmdPrint's F11 empty-answer guard (the run ends as
     `error_during_execution`, exit 1 — never a silent success).
  2. *Defect — Unown's print contract:* with the run ended, cmdPrint's
     teardown (fleet-drain sentinel submission, runtime dispose) hung past
     the post-answer hard-exit grace (`printExitGraceMs`, 15 s default — the
     F10 boundedness net for Bun's keep-alive sockets), and BOTH forced-exit
     paths — the +15 s hard exit and the 180 s stall guard — called
     `process.exit()` **bare**: the envelope (assembled in the `finally`
     block the forced exits outrun) was never written. Bounded, but silent:
     every unattended caller (CI, engine automations, this round's build
     driver) loses the result. Pre-fix code:
     `armHardExit` → `process.exit(0)` with no write; stall guard →
     `process.exit(1)` with no write.
- **Unown defect?** YES — the envelope loss. The upstream empty stream is
  an external fault the guard stack already answers honestly; losing the
  error report on top of it is the CLI's own contract violation ("the
  envelope gains…" is the print-mode contract).
- **Benchmark/fix created:**
  - `pi-repo/packages/self-learning/test/print-exit-envelope.test.ts` —
    pins that the hard-exit grace calls the `lastResort` hook BEFORE
    `process.exit(0)` (order-asserted), that a throwing hook never blocks
    the exit (fail-open boundedness), and that `assembleResultJson` carries
    the new honest subtype `forced_exit`.
  - Fix (three files, behavior change):
    `installPrintStallWatchdog(runtime, lastResort?)` now runs a caller
    hook immediately before every forced exit; cmdPrint installs a
    per-lane last resort — the `--output-format json` lane writes the FULL
    envelope (`subtype: "forced_exit"`, the answer text — cap-recovered per
    LR-1b —, usage, capped/loop-guard facts) via `writeSync(1, …)` so no
    exit race can lose it, and the text/`--mode json` lanes emit the stderr
    note (stdout there already carries the live answer). The watchdog also
    returns a `dispose()` (clears stall/hard-exit/poll timers) so the pinning
    test can run the real watchdog without keeping the test process alive.
- **Validation evidence:** 4/4 new tests pass
  (`bun test test/print-exit-envelope.test.ts`); the pre-existing suites at
  the touched seams stay green (output-format 15/15 with stall-progress);
  `bun bin/unown -p "Reply with exactly: F3-FIXED-OK"` — `F3-FIXED-OK`;
  tsc clean on the changed files; biome applied.
- **Rerun of the original workflow:** the interrupted build session resumed
  through the same detached launcher with the fix live (bun runs the
  package from source) — receipts continue, and any future forced exit
  writes the envelope instead of vanishing (the envelope's arrival — any
  subtype — is now the driver's resume/stop signal).
- **Retention/regression:** the pinning test is the regression net; the
  CHANGELOG carries the Agent Behavior entry (`forced_exit` subtype, the
  stderr line, `PI_PRINT_EXIT_GRACE_MS` note in docs/usage.md +
  docs/configuration.md).

### F4 — usage-log rows with zero prompt/completion tokens on healthy responses (closed: logging gap, documented — no behaviour change)

- **Description:** while root-causing F3, the bridge usage log showed 19/166
  streamed calls with `promptTokens: 0, completionTokens: 0, status: "ok"` —
  at first read indistinguishable from the F3 trigger's truly-empty
  completions.
- **Reproduction:** a controlled 12-call concurrent campaign
  (`scripts/degenerate-repro.mjs`, small and ~84k-token prompts, tools
  declared) returned 12/12 healthy completions to the client while the usage
  log recorded zero-token rows for some of the same requests (paired good
  rows at identical timestamps).
- **Root cause:** the upstream intermittently omits the SSE usage frame (or
  sends zeros) on otherwise-healthy streams; `foldSseLine` only updates the
  entry's token counters when a usage frame arrives, so the row logs the
  entry's initial zeros. A logging gap, not a content fault — the F3
  trigger's rows differ in kind (the transcript's assistant message content
  was `[]` with usage 0 from the provider frame itself).
- **Unown defect?** Cosmetically yes (the log overstates emptiness); no
  behaviour change warranted — the row's `status`/duration still tell the
  truth, and "repair" would mean inventing token numbers the upstream never
  sent. Documented here so the next reader of the usage log does not
  misread healthy traffic as degenerate (this entry is that fix).
- **Benchmark created:** this entry + the repro script's classification
  (`EMPTY` vs `WHITESPACE` vs `ok-text`) for future campaigns.
- **Validation evidence:** the repro campaign's client-side tally vs the
  usage-log rows (12/12 ok-text client-side; zero-token rows logged).
- **Retention:** the distinction (zero-token row ≠ degenerate completion)
  is recorded here and cited by F3's analysis.

### F6 — the dev-origin trap: 127.0.0.1 vs localhost in Next 16 dev (closed: caller environment — a lane rule, not a code change)

- **Description:** on the resuming environment, the E2E phase's first two
  sessions (and the operator's spot checks) saw the app permanently wedged
  on "Loading…" — no login form, zero API calls — while the upstream E2E
  pass on the predecessor environment was all-green on the same commit.
  Two build sessions chased the wedge as an app bug (one shipped a
  `setLoading` restructure that never addressed it) before the operator
  killed them for duplicating the upstream E2E.
- **Reproduction:** Playwright (real Chrome 156, agent-browser lane) at
  `http://127.0.0.1:3000/parley`: the page loads every chunk (no 404s
  beyond the favicon, no pageerror, no unhandled rejection), React runs
  (the devtools banner prints), but hydration never completes — the boot
  effect's `fetchJson("/parley/api/auth/session")` never fires, and the
  console fills with `WebSocket connection to 'ws://127.0.0.1:3000/_next/hmr'
  failed: ERR_INVALID_HTTP_RESPONSE`. The dev server log names it:
  `Blocked cross-origin request to Next.js dev resource /_next/hmr from
  "127.0.0.1"`. Navigating the same server at `http://localhost:3000/parley`
  boots instantly: session 401 → login form → login 200 → nine API lanes
  200 → SLA chips, filters, thread, composer all render (screenshot
  `/tmp/parley-shots/spot-inbox.png`, the resuming operator's receipts).
- **Root cause:** Next.js 16 dev treats the HMR socket as a same-origin
  dev resource pinned to the announced host (`localhost`); a page served
  from `127.0.0.1` is a cross-origin HMR client and is blocked — and with
  the HMR handshake rejected, the dev client's hydration pipeline stalls
  before any effect runs. The upstream E2E lane used `localhost`
  throughout; the resuming environment's briefs and driver scripts used
  `127.0.0.1` — the asymmetry, not the app, produced the "wedge".
- **Unown defect?** No — the app is innocent (proven by the localhost
  boot). But the lane rule was unwritten, and it cost two sessions.
- **Benchmark created:** this entry; the E2E brief's setup section now
  pins the host (any future E2E driver navigates `localhost:3000` — or
  configures `allowedDevOrigins` — never bare `127.0.0.1`).
- **Improvement applied:** procedural (the host pin in the E2E brief);
  no app change — the app boots correctly, and hardening it against a
  dev-only origin policy would be patching around the caller.
- **Validation evidence:** the paired boots (127.0.0.1 wedged /
  localhost green) on the same server process, same commit (`9ea0a4f`),
  same browser; the dev-server log line; the two dead sessions' receipts
  (`…181654-ktqe.jsonl`, `…183136-97hd.jsonl`).
- **Retention:** the rule lands in the phase brief and here; any future
  "app wedges on Loading" report on this repo checks the host FIRST.

### F7 — the favicon the layout references was never committed (closed: app defect, fixed by the landing phase)

- **Description:** `src/app/parley/layout.tsx` links
  `/parley/favicon.svg` (the metadata icons block), but no commit ever
  tracked `public/parley/favicon.svg` — every fresh clone serves a 404
  there (visible in the E2E console capture; the tab falls back to the
  default document icon).
- **Reproduction:** `git ls-tree -r origin/main --name-only | grep
  public/parley` → empty; `curl -I localhost:3000/parley/favicon.svg`
  → 404.
- **Root cause:** the UI-phase session wrote the asset into its working
  tree but the phase commit captured only source files; the E2E pass
  (8 steps, console-clean rule) ran on the authoring tree where the file
  existed — a worktree-only asset passing a same-tree verification.
- **Unown defect?** App defect (a referenced, untracked asset — the
  shipped route 404s on every fresh clone), minor.
- **Benchmark created:** this entry; the landing phase's checklist gains
  the asset-existence gate (every referenced public asset must be
  tracked — the same class of check `verify-deploy.mjs` runs for landing
  media).
- **Improvement applied:** the landing phase commits a real
  `public/parley/favicon.svg` (two overlapping speech-bubble glyph, the
  app's accent) and the gallery's poster pass re-shoots with it live.
- **Validation evidence:** this entry + the landing commit that adds the
  asset; `curl -I` flips 404 → 200 with `image/svg+xml`.
- **Retention:** the asset is tracked from the landing commit forward;
  the deploy-verify lane covers every landing media URL already, and the
  favicon joins the app-route surface it checks.
