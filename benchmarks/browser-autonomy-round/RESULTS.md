# Browser autonomy round — RESULTS

The browser autonomy round's benchmark receipts (2026-11-01). Methodology:
every number below comes from a committed receipt under `receipts/` — a
per-run session JSONL (the agent's full event stream), the exported
transcript where useful, and `stress-checkout-summary.json` for the pinned
configuration (model `agnes-3.0-flash` via the bundled bridge →
`https://apihub.agnes-ai.com/v1`, engine v0.0.55 @ `22d3e725`, harness
`unown -p` print mode, fresh session per run). Model calls counted as
assistant messages in the session store (a turn = one model call); durations
are session wall-clock. A figure with no receipt is `null` — never a guess.
Per [the benchmarks' contract](../AGENTS.md): accuracy is always paired with
cost/latency, and the suite pins everything (fixture, model, harness, date).

## The mission's ten benchmarks

| Benchmark | Cold run | Warm run | Improvement |
|---|---|---|---|
| GitHub Issue Creation | browser-first attempt receipted (login probe: 3 calls / 9.8 s — a PAT cannot sign the web UI, fallback logged), then REST: #43 filed | #44, #45 filed immediately after (same session, zero re-probing) | the fallback knowledge is one-time; the probe is receipted and in memory — future issue work goes straight to the API lane |
| Repository Review | visitor journey: 34 calls / 151.8 s (hit the 30-turn cap) + 3 calls / 9.8 s resume → full structured audit; demo-app defect hunt: 41 calls / 145.5 s → F4 found | null (not re-run this round) | the cap is the honest cost of a full-page audit on a flash model; the resume lane (18 s) is the warm path |
| Documentation Discovery | inside the MDN run: page found + API facts extracted | round 2: the Canvas `roundRect` page found and every overload + the exception semantics extracted in the same run (see the navigation row's receipts) | discovery held on a second domain — no relearning of the workflow |
| Documentation Navigation | MDN `Intl.Segmenter`: 9 calls / 33.1 s, discover → navigate → implement → run → verify, ZERO interventions, correct output first try (receipt `docs-nav.jsonl`) | round 2, second technology — MDN Canvas `roundRect`: 12 calls / 39.5 s, zero interventions, ALL overloads verified (single radius, array, `{x,y}` object, `DOMPoint`, and the documented `RangeError` on a 5-element radii list — pixel-level corner probes), the hint digest rode the first browser call (receipt `docs-navigation-canvasroundrect.jsonl`); control: the same task in a fresh project with no memory — 12 calls / 46.9 s, the lane correctly silent (receipt `docs-navigation-canvasroundrect-freshproject.jsonl`) | VALIDATED on first exposure and on transfer: a second technology, same workflow, zero interventions both times — call count is task-sized (the round-2 task verified five overload forms vs one), not a regression |
| Vercel Deployment | push `e7e0a43d` → deploy-verify green (live routes, SEO, media asserted) | pushes `5eb1b973` (red — the F5 claims drift) and `0e9eca7e` (green) | the lane does its job: a red parallel deploy was detected and the fix verified; production hydration independently browser-checked |
| Bug Reproduction | F4 (dead demo app): 41-call session found the symptom, second browser stack reproduced, localhost-vs-IP isolated; F3 (iframe fill race): 16 calls / 26.5 s standalone repro + characterization | post-fix repro: 9 calls / 17.8 s — PASSED on the first save (the frame-readiness barrier prevented the race entirely) | silent data loss → prevented + verified; the repro script is the fixture (`fixtures/stress.html`), reusable as-is |
| Competitor Research | the URL-verified 8-system sweep ([the research doc](../../docs/browser-autonomy-competitor-research.md)) + this round's browser runs | null (the weekly routine `auto-mvxw0wne-onkwcn` is armed — next run 2026-11-08) | the routine automates the warm lane: only deltas vs this baseline get noted |
| Release Monitoring | 4 calls / 20.3 s, 3/3 competitor releases pages loaded anonymously, versions cross-validated against the independent research sweep (identical: browser-use 0.13.14, playwright-mcp v0.0.84, stagehand v3.7.7) | the routine's future runs (armed, read-only) | two independent methods agreed on every version — the sweep is repeatable |
| PR Review | null — the repo's binding round convention is direct-to-main with the full CI gate set ([AGENTS.md](../../AGENTS.md)); the issue tracker (#43-#45) carries the external-contribution flow | null | recorded as an honest null with the convention reason, not skipped silently |
| Documentation Audit | visitor journey: the install command on the page matches `docs/install.md` exactly; the F5 memory-drift was CAUGHT by the repo's own `check:claims` gate (62 page literals) — a real audit find with a fix | null | the audit found one drift and one dead-button class defect; both fixed in-round |

Interventions: **zero human interventions inside any browser run** — every
run completed autonomously; the operator's work was prompt design, turn
caps, and the fix cycles between runs.

## The stress-checkout suite (the round's own benchmark)

The hostile checkout fixture (nine planted failure classes —
[fixtures/stress.html](fixtures/stress.html)) completed blind by the
terminal agent:

| Run | Label | Duration | Model calls | Exit | Success | Dialog-trap behaviour |
|---|---|---|---|---|---|---|
| 1 | cold (blind) | 31.7 s | 17 | 0 | yes | hit; recovered via `dialog list` exploration + accept arming (2 recovery actions) |
| 2 | warm (pre-dream) | 78.7 s | 18 | 0 | yes | hit; same recovery depth |
| 3 | post-dream (memory v2) | 46.2 s | 25 | 0 | yes | hit; DIRECT recovery (re-arm + re-click, no exploration) |
| 4 | iframe race repro (targeted) | 26.5 s | 16 | 0 | yes | — (found F3) |
| 5 | post-fix repro | 17.8 s | 9 | 0 | yes | race prevented at the source (first-save success, no re-fill needed) |
| 6 | post-hint-lane ([#45](https://github.com/kanishka-namdeo/Unown/issues/45) fixed) | 41.5 s | 16 | 0 | yes | **NOT HIT — pre-armed** `browser dialog accept text=OK` BEFORE the triggering click (arm = call #11, click = #12), citing the learned procedure; the first browser call carried the 8-entry memory digest (receipt `stress-run-4-posthint.jsonl`) |

Honest readings: model-call count on an identical task class is noisy
(17/18/25/16 — do not read a trend into four samples); the durable signals
are **success rate (6/6)**, **recovery depth on the dialog trap (2
exploratory actions → 1 direct → 0 — prevented)**, and **prevention after
the fix**. The memory recall verdict (VALIDATED) and the
proactive-application verdict — PARTIAL through run 3, **VALIDATED from run
6** (the tool-time hint lane, [#45](https://github.com/kanishka-namdeo/Unown/issues/45)) — are
in the session log CP2b and the round-2 session log; the screenshot from
run 6 is also the first checkout artifact saved as a true PNG ([#44](https://github.com/kanishka-namdeo/Unown/issues/44)).

## Capability verdicts (the round's lanes)

| Lane | Verdict | The receipt that decides it |
|---|---|---|
| BROWSER-1 research & competitive intelligence | VALIDATED | the 8-system research doc (every claim URL-cited) + the browser release sweep cross-validated |
| BROWSER-2 PM operations | VALIDATED (with a logged fallback) | issues #43-#45 filed; the browser-first attempt receipted — a PAT cannot sign GitHub's web UI (by design), fallback to REST |
| BROWSER-3 docs navigation | VALIDATED | MDN `Intl.Segmenter`: discover → navigate → implement → run, zero interventions |
| BROWSER-4 authenticated platforms | PARTIAL | browser-profile + CDP-attach docs verified; GitHub's authenticated API surface used via PAT; no real third-party login surface existed in the sandbox — the honest gap, recorded |
| BROWSER-5 user simulation | VALIDATED | the demo-app hunt found F4 (a real, fixed defect) and the visitor journey audited the page like a customer |
| BROWSER-6 long-horizon | PARTIAL | the release-monitoring baseline is receipted and the weekly routine is armed; multi-day continuity is structurally out of one session's reach — the checkpoint log is the resumption contract |
| BROWSER-7 memory integration | VALIDATED (recall; proactive application from round 2, run 6) | dreams v1/v2 consolidated browser facts unprompted; run 3 recalled the dialog lesson and recovered directly; run 6 (the [#45](https://github.com/kanishka-namdeo/Unown/issues/45) tool-time hint lane) PRE-ARMED before the confirm click — the gap closed |
| BROWSER-8 failure-driven improvement | VALIDATED | F1-F5 all root-caused with `file:line`; F3 fixed + live-pinned in-round; F4 fixed + config-pinned; every recurring failure class became a memory entry, an issue, or a fix |
| BROWSER-9 self-dogfooding | VALIDATED | Unown's browser audited Unown's landing/docs/demo, found two real defects, both fixed and browser-verified in-round |

## Cost note

All model traffic ran through the bundled bridge on the Agnes free tier
(~20 RPM, serialized, max 3 concurrent) — the per-run token figures are in
each session JSONL receipt (`message_update.usage` events); the engine's
governor kept the round inside its budget (60 calls/hr, 200k tokens/hr).
