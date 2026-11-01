# The Browser Autonomy Round 2 — session log (2026-11-01)

> **Purpose.** The continuation round of the [browser autonomy round](browser-autonomy-round-session.md):
> working the queue it left — the carries-overs #46, #45, #44, the warm
> docs-navigation benchmark on a second technology, and the skill-promotion
> decision — each closed with the same discipline: browser-first where a
> browser can do it, every fallback logged, every fix pinned three ways
> (unit, live, end-to-end through the terminal agent), receipts committed.

- Round owner: the browser autonomy round 2 (lineage: the browser autonomy
  round → this round)
- Status: **complete** — all five queue items closed: #46 fixed on all three
  fronts (gate EXACT + remedy, renderer pinned, convention documented),
  #44 fixed (extension honored, clashes loud), #45 implemented AND measured
  (the hint lane turned recall into application — the dialog trap
  **prevented** for the first time in six runs), the warm docs-navigation
  benchmark run on a second technology with a fresh-project control, and the
  hostile-checkout skill promoted and session-verified. Three commits:
  `6224668c` (#44) → `fe8b5f9c` (#46) → `c1272620` (#45) + this closeout.
- Related: [round 1's log](browser-autonomy-round-session.md) ·
  [browser](browser.md) · [memory](memory.md) · [skills](skills.md) ·
  [the benchmarks](../benchmarks/browser-autonomy-round/RESULTS.md)

---

## Environment checkpoint (resumable)

- Sandbox lineage `/home/z/my-project/unown`, clone @ `fc19be87` (main, clean,
  v0.0.55 + the plan-mode V3 round's docs). bun **1.4.3** installed to
  `~/.bun/bin` (the sandbox ships 1.3.14 — below the 1.4 lockfile floor).
- `bun run agent:install` 7/7 green (engine OS service skipped — no systemd
  user bus in the container, the documented container lane); `.env` with the
  Agnes upstream (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key
  set, `BRIDGE_KNOWN_MODELS=agnes-3.0-flash,agnes-2.5-flash`); specs pinned
  via `unown setup --provider bridge --context-window 131072 --max-tokens
  32768`. Stack: bridge :3031 (upstream 200, six agnes models), engine :3030
  (phase ready, bearer token at `data/self-learning/engine.token`).
  `unown doctor` green. Landing page: `bun run dev` :3000.
- Baseline gates on the pristine tree, all green before any edit: typecheck 0
  · lint 0 errors (4 pre-existing warnings) · `test:unit` 2069/0 ·
  `check:docs` 133 · `check:changelog` · `check:blog` · `check:benchmarks` ·
  `check:claims` 62/62.
- Round-1 verification (CP1): all 13 receipts present, project memory carries
  the browser lessons, issues #43-#46 open (read through the browser),
  `.unown/skills-staged/` empty (the round-1 candidate was a decision, not a
  mint — this round made it).
- The stack is mortal across sandbox recycles: resume = `bun run
  agent:start`, re-check `/health` + `/api/overview`, re-serve the fixture
  (`python3 -m http.server 8090 --directory
  benchmarks/browser-autonomy-round/fixtures`), then resume from the CPs
  below.

## CP1 — #44: the screenshot extension/format contract (F1)

The fix: `resolveScreenshotFormat` (pure, in `browser/session.ts`, validated
before any browser work) — a recognized image extension with no explicit
`format` picks the capture format (`.png` → png, `.jpg`/`.jpeg` → jpeg); an
explicit `format` fighting a recognized extension refuses loudly with the fix
in the message; unrecognized/absent extensions keep the jpeg default; every
saved artifact's receipt names its actual format (`saved: … (png)`).

- Unit: 10 tests in `test/browser.test.ts` (mapping, case/path robustness,
  the loud mismatch, refusal-before-browser-launch reachability).
- Live: 2 tests in `test/browser-live.test.ts` against a real Chromium (a
  `.png` name with no format captures PNG magic bytes; a clash refuses and
  writes nothing). Suite 44 pass + 1 skip.
- E2E: `unown -p` against the live landing page — `shot-e2e.png` is a real
  1280×720 PNG on disk, exit 0.

## CP2 — #46: the dream-render/landing-quote coupling, closed three ways

**The root cause of the silent half (occurrence 2), found by re-running the
drift in this tree**: the claims gate's `matchLiteral` leniency — template
prefix + shared-12-char-window matching, built for `${}`-interpolated engine
logs — was applied to `.unown/memory/project.md`, an authored-markdown file
where `extractTemplates` misreads backtick code spans as JS template
literals (82 bogus segments; an unpaired backtick shifts the pairing so
prose BETWEEN spans becomes long segments). A fully pruned quoted line then
passed the gate because an unrelated entry elsewhere shared the 12-char
window `" verificatio"` with it. **Reproduced empirically**: deleting the
stealth-verification line left `check:claims` green at 62/62.

1. **Gate-side**: the dream route is now `exact: true` — verbatim containment
   or failure — and a memory-route failure prints its remedy on the follow-up
   line (`restore the line under ## Manual notes …`). Verified by simulation:
   the deleted-stealth-line tree FAILs `1 of 62` with the remedy; restored,
   62/62. Pinned by 2 gate tests — the first proves the lenient matcher WOULD
   pass the fixture (the leak itself is pinned), then that the exact path
   refuses it.
2. **Renderer-side**: pinned in `test/manual-notes.test.ts` — a
   landing-quoted line survives a render that prunes its platform-memory
   twin at the 110-bullet cap (occurrence 1's shape): the sentence appears
   exactly once, from Manual notes, and the footer says it pruned. 27/27.
3. **Content-side**: the convention documented at both ends — a comment on
   `loop.tsx`'s dream body (edit the body only together with the memory
   file's Manual notes) and a paragraph in `docs/memory.md`.

**The systemic proof during THIS round**: the engine's auto-dream re-rendered
the tracked memory mid-round (consolidating this round's sessions — the
learning loop learning from the round again) and `check:claims` stayed green
through it: the quoted lines live in Manual notes, the render preserved them,
the gate verified. The class is closed, not just the two occurrences.

## CP3 — #45: the tool-time browser-memory hint lane (measured)

The lane (`browser/hints.ts`, wired in `browser/tools.ts`): the FIRST
browser call of a session appends a bounded `⟨browser memory hints⟩` digest
(≤ 8 browser-relevant entries from the project + user tiers, deduped,
clipped) after the action's own result; the first `navigate` to a host the
memory mentions carries that host's slice — once per session / once per
host. Cheap (two file reads, no engine DB — the detached-engine contract
intact); honest (repo-resident project memory runs through the same
injection guard as the M10 session-start injection — flagged entries
annotated `[unverified — injection-guard flagged]`, never silently
included); killable (`UNOWN_BROWSER_HINTS=0`). 13 unit tests.

**The measured effect — stress-checkout run 6** (receipt
`receipts/stress-run-4-posthint.jsonl`, screenshot
`screenshots/stress-final-posthint.png`):

| Run | Lane | Duration | Calls | Dialog trap |
|---|---|---|---|---|
| 1 | cold (blind) | 33 s | 17 | hit; 2 recovery actions |
| 2 | warm (pre-dream) | 79 s | 18 | hit; 2 recovery actions |
| 3 | post-dream | 47 s | 25 | hit; 1 direct recovery |
| 6 | **post-hint-lane** | 41.5 s | 16 | **NOT HIT — pre-armed (call #11 arm, #12 click), citing the learned procedure** |

BROWSER-7's proactive-application verdict moves PARTIAL → **VALIDATED**: the
digest rode the first browser tool result, and the agent applied the
procedure BEFORE the moment of failure — recall became application. The
address form also saved first-attempt (#43 holding), and the run-6
screenshot is the first checkout artifact saved as a true PNG (#44, same
round). The dream that followed consolidated the round's own lesson into
memory ("Before performing critical UI actions … always proactively dismiss
cookie banners and newsletter modals") — the loop learning from the run that
validated the loop.

## CP4 — the warm docs-navigation benchmark, second technology (BROWSER-3)

MDN Canvas `roundRect` — a different API family from round 1's
`Intl.Segmenter` — discover → navigate → extract → verify, driven by the
terminal agent:

- **Warm run** (repo cwd, memory + hint lane live): 12 model calls / 11 tool
  calls / 39.5 s, zero interventions, the hint digest rode the first browser
  call. Verified ALL overloads empirically (single radius, array
  `[10,20,30,40]`, `{x,y}` object, `DOMPoint`, mixed list) including the
  documented `RangeError` on a 5-element radii list, with pixel-level corner
  probes (receipt `receipts/docs-navigation-canvasroundrect.jsonl`).
- **Control** (fresh `/tmp` project, no project memory): 12 calls / 46.9 s —
  the lane correctly silent (nothing to say), the workflow unchanged
  (receipt `receipts/docs-navigation-canvasroundrect-freshproject.jsonl`).

Verdict: **VALIDATED on transfer** — a second technology, same workflow,
zero interventions both times. Call count is task-sized (five overload forms
verified vs one), not a regression; the honest comparison is the workflow,
not the count.

## CP5 — the skill-promotion decision: PROMOTED

Round 1 left the hostile-checkout procedure as a candidate, promotion
deliberately deferred to a human decision (the 2026-10-22 hardening: staged
skills are never auto-loaded). This round's decision: **promote** — the
procedure is validated across six receipted runs, this repo's benchmark
suite re-runs it, and it complements the hint lane (full procedure up front
vs just-in-time pointer at the tool call). Shipped as
`.unown/skills/hostile-page-checkout/SKILL.md` (six steps, each tied to the
run that earned it); verified loading in a real session (`unown -p "list the
project skills"` → `hostile-page-checkout` present); documented in
`docs/skills.md`.

## The fallback ledger (browser-first, every deviation)

1. GitHub issues #43-#46 READ through the browser (anonymous pages load
   fine) — no fallback needed for reading. Issue STATE confirmed (all open).
   No issue creation was needed this round (the fixes close existing ones).
2. The gate simulations (#46) — file edits + `check:claims`, not browser
   work; the browser is not the tool for editing local files, and this is
   not a browser task (same class as round 1's REST fallback, root cause:
   the task is local-file-shaped).
3. Everything else (landing-page verification, the stress run, the
   docs-navigation runs) ran through the browser via the terminal agent —
   no fallbacks.

## What changed (the round's commits)

| Commit | What |
|---|---|
| `6224668c` | #44: the screenshot extension/format contract (resolver + schema + docs + 12 tests) |
| `fe8b5f9c` | #46: the coupling closed three ways (exact gate + remedy, renderer pin, convention docs + 2 gate tests + 1 renderer test) |
| `c1272620` | #45: the tool-time hint lane (hints.ts + wiring + 13 tests + run-6 receipt + RESULTS/verdict updates) |
| this closeout | the warm docs-nav receipts + benchmark table, the promoted skill, docs/skills.md, this log, SESSION.md |

## The next round's queue

- The release-monitoring routine's first weekly run (`auto-mvxw0wne-onkwcn`,
  2026-11-08) — the multi-day lane's first real datum; check the routine
  notes only deltas vs the baseline.
- The hint digest's RANKING: after the mid-round dream, newest facts push
  older-but-relevant entries (the dialog lesson) below the 8-entry cap — a
  relevance-ranked digest (or a per-category quota) is the natural next
  refinement; the cap is the documented design, the ranking is polish.
- The benchmark suite's cold/warm deltas now have two filled rows
  (docs-navigation, bug-reproduction); repository-review and
  competitor-research warm runs remain the honest nulls.
- The pre-existing queue from SESSION.md (the S2 ledger, the injection
  scanner ML classifier, the delegation reuse axis) — unchanged, still
  queued.
