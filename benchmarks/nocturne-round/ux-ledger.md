# The nocturne round — end-user experience ledger

One row per real agent session the nocturne round runs, measuring what the
mission calls the end-user experience: interventions required, clarifications
asked, completion, efficiency and consistency. All sessions are real headless
`bin/unown -p "..."` runs in this repository (the controlled environment),
model `agnes-3.0-flash` through the bundled bridge. Rows are numbered N1,
N2, ... in chronological order.

Column key:

- **session** — the round's session id (N1, N2, ...), chronological
- **kind** — cold (no relevant memory) / recall (answer lives in tracked
  project memory) / repeat (same-shape task re-run after consolidation) /
  plan (a `--plan` session)
- **phase** — the build phase the session belongs to
- **task** — one line, the actual user request
- **turns** — model calls (from the session envelope `num_turns`)
- **tokens in/out** — from the envelope / engine ledger
- **wall** — wall-clock seconds for the whole session
- **interventions** — times the operator had to step in (headless sessions
  start at 0 by construction; any non-zero row is itself a finding)
- **clarifications** — `ask`-tool questions the agent raised (headless
  sessions cannot be answered; a question is a failed-turn signal)
- **outcome** — completed / partial / failed, judged by the objective
  acceptance check stated in the task
- **memory used** — did tracked project memory demonstrably carry the
  answer or speed the work: yes / no / n-a

| session | kind | phase | task | turns | tokens in/out | wall | interventions | clarifications | outcome | memory used |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 | plan | Plan | read-only exploration for the nocturne build contract (`--plan`, capped) | 40 (capped) | 149,939 / 2,272 (+1.91M cache reads) | 79s | 0 | 0 | partial — exploration of aria/parley/fugue/cadence patterns + round conventions; cap hit mid-exploration, resumed per the gallery convention | yes |
| N2 | plan (resume) | Plan | write the complete numbered build contract | 5 | 219,754 / 16,901 | 195s | 0 | 0 | completed — 52,587-char plan, all 8 sections ([plan.md](plan.md)); every pattern grounded in the sibling lanes it explored | yes |
| N3 | cold (build) | Lib | execute Phase 1: lib modules per contract §2 (capped mid-exploration) | 40 (capped) | 304,966 / 3,979 | 466s | 0 | 0 | partial — contract + sibling-pattern exploration; zero writes yet (heavier read phase than aria's A3 — the 21-module contract is deeper) | yes |
| N4 | repeat (resume) | Lib | continue: start writing modules | ~28 (killed) | unreceipted | ~590s | 1 (operator) | 0 | partial — 20 files written (12 modules + tests) before the OPERATOR's blocking shell call timed out and killed the run; the launcher-contract deviation (no detached F0/F2 launcher yet) is the operator's defect, logged as F8 | yes |
| N5 | repeat (resume) | Lib | continue: engine modules + fix loop | 40 (capped) | 243,952 / 32,806 | 589s | 0 | 0 | partial — rotation.ts + sla.ts landed, 174/181; nextHandoff period-anchoring bug mid-fix, resumed | yes |
| N6 | repeat (resume) | Lib | continue: store.ts + remaining modules | 40 (capped) | 521,420 / 32,954 | 694s | 0 | 0 | partial — store.ts landed, 181/181 green again; context drag visible (521K cumulative in — the aria A9 signal); operator folded to a fresh session per the fold-not-fanout convention | yes |
| N7 | cold (build) | Lib | fresh session: the 8 remaining engine modules + PBT invariants | 40 (capped) | 210,087 / 58,247 | 766s | 0 | 0 | partial — all 8 engine modules + invariant tests written in one session (346/358), fix loop pending | yes |
| N8 | repeat (resume) | Lib | the fix loop to green | 40 (capped) | 190,392 / 15,146 | 361s | 0 | 0 | partial — 356/360; found + was fixing a real seed-invariant bug (escalation-after-ack) | yes |
| N9 | repeat (resume) | Lib | finish: green suite + clean typecheck | 40 (capped) | 47,706 / 11,900 | 285s | 0 | 0 | completed — 360/360 green, `bun run typecheck` clean, 40 files, zero human edits to app code | yes |
| N10 | cold (build) | API | Phase 2 start: plan §3 read + aria route conventions + verify lib | 40 (capped) | 148,790 / 5,175 | 142s | 0 | 0 | partial — route directory skeleton + helpers (_auth/_rate/_state) explored; capped pre-write | yes |
| N11 | repeat (resume) | API | continue: write route files | 40 (capped) | 70,291 / 17,713 | 310s | 0 | 0 | partial — 11 route files (auth, tenants, members, invites) written | yes |
| N12 | repeat (resume) | API | continue: route groups in plan order | 40 (capped) | 60,195 / 35,963 | 530s | 0 | 0 | partial — 32 files; services/rotations/alerts/incidents groups done, runbooks+ remaining | yes |
| N13 | repeat (resume) | API | finish routes + write the API test files | 40 (capped) | 85,503 / 28,430 | 496s | 0 | 0 | partial — 44 files, 4 test files, 75/76; stuck on the admin-override DELETE 403 (misdiagnosed as RBAC carve-out — actually F9, the session-id collision) | yes |
| N14 | repeat (resume) | API | fix the last failing test | 40 (capped) | 60,773 / 14,134 | 515s | 0 | 0 | partial — no convergence on the failing test (context drag; "misread my own edits"); operator traced the real root cause (F9) | yes |
| N15 | cold (fix) | API | fed-diagnosis fix: the loginSession seq-collision P0 + regression pin | 14 | 31,026 / 2,834 | 261s | 1 (diagnosis) | 0 | completed — nextId("ses") fix + 3-login distinct-id regression test; API 78/78, full repo 1880/1880, typecheck clean | yes |
| N16 | cold (build) | UI | Phase 3 start: aria UI conventions study (provider, shell, tests) | 40 (capped) | 280,871 / 3,146 | 124s | 0 | 0 | partial — conventions mapped; capped pre-write | yes |
| N17 | repeat (resume) | UI | provider + shell + login + dashboard + primitives | 40 (capped) | 85,716 / 29,135 | 444s | 0 | 0 | partial — provider, shell, login, dashboard, primitives written | yes |
| N18 | repeat (resume) | UI | remaining screens + component tests | 40 (capped) | 76,729 / 36,619 | 581s | 0 | 0 | partial — all 13 components + 2 test files (19/28), fix loop pending | yes |
| N19 | repeat (resume) | UI | the fix loop to green | 27 | 282,131 / 7,332 | 571s | 0 | 0 | completed — 28/28 components green, full repo 1909/1909, typecheck clean | yes |
| N20 | cold (build) | Embed | Phase 4: CSP block, favicon, gallery entry #7, receipts | 40 (capped) | 384,114 / 18,056 | 1171s | 0 | 0 | partial — CSP + favicon + gallery entry written; capped polling the dev server for the poster | yes |
| N21 | repeat (resume) | Embed | the poster (live capture) + the 4 pinned landing tests | 37 | 99,915 / 5,016 | 799s | 1 (resetType) | 0 | completed — 2880×1800 live capture, 136 landing tests green, full repo 1909, build clean (operator caught + fixed a resetType mismatch: gallery sent "nocturne", provider listens for "nocturne-reset") | yes |
| N22 | cold (build) | Verify | write the 10-step live Chromium ui-pass (the aria ui-pass model) | 29 | 172,720 / 6,387 | 124s | 0 | 0 | completed — benchmarks/nocturne-round/ui-pass.mjs written + syntax-checked; first live run 5/10 exposed F12 (the rotations/runbooks detail crash) | yes |
| N23 | cold (fix) | Verify | fed-diagnosis fix F12: provider detail-shape parsing | 30 (capped) | 112,297 / 8,538 | 166s | 0 | 0 | partial — provider parsing fixed; capped mid-test-write leaving a dangling comment (syntax error in the test file) | yes |
| N24 | repeat (resume) | Verify | repair the capped edit + finish the F12 regression pins | 19 | 31,058 / 3,122 | 516s | 0 | 0 | completed — F12 pins green, error boundary in shell, full suite green *(work lost to the sandbox reset — re-landed by N25/N26; see the checkpoint note)* | yes |
| — | *(environment)* | — | the workspace was reset mid-round (container re-provision); all pushed milestones survived, the un-pushed N22–N24 work was rebuilt: ui-pass.mjs restored verbatim, F12 refixed (N25/N26), stack + engine reinstalled | — | — | — | — | — | recovered — the push-on-every-milestone discipline is what made the loss recoverable; the checkpoint log now lives IN the repo | n-a |
| N25 | cold (fix) | Verify | re-land the F12 fix after the reset: provider detail-shape parsing | 30 (capped) | 125,974 / 4,767 | 118s | 0 | 0 | partial — provider parsing + boundary written; capped verifying shell reset refs | yes |
| N26 | repeat (resume) | Verify | finish the F12 regression pins | 20 (capped) | 35,067 / 9,590 | 147s | 0 | 0 | completed — 31 component tests green, F12 pins in place | yes |
| N27 | cold (fix) | Verify | fed-diagnosis fix F13: the aria hasSession pattern (skip the 401-logging probe) | 30 (capped) | 141,771 / 5,095 | 125s | 0 | 0 | partial — page.tsx + provider + public-status lanes written; capped on comments | yes |
| N28 | repeat (resume) | Verify | finish F13 + full verification | 15 | 25,443 / 3,983 | 313s | 0 | 0 | completed — 1916 tests green, typecheck + lint + build clean; live ui-pass **10/10 twice consecutively, 0 console errors** (after the operator cleared a stale standalone server holding :3210 — a next-server process pkill missed) | yes |
