# Browser autonomy — competitor research (the browser autonomy round, 2026-11-01)

> **Purpose.** Ground the browser autonomy round's verdicts in what the
> browser-agent category actually ships today: eight systems reverse-read
> on the round's own axes (element addressing, failure recovery, memory
> and learning, authenticated sessions, benchmarks), the 2026 benchmark
> landscape, and the adopt/reject ledger for Unown's browser tool. The
> headline: **nobody persists a memory of failed browser actions between
> sessions** — the axis Unown's tiered memory + AutoDream already operates
> on, which makes the round's recall-vs-application finding (session log
> CP2b) the credible next wedge.

- Round: the browser autonomy round ([session log](browser-autonomy-round-session.md))
- Method: live fetches on 2026-11-01 (the research subagent's URL-verified
  sweep + this round's own browser-tool runs where noted); claim tiers
  `[V]` verified at a cited URL · `[C]` upstream-claimed, not re-derived ·
  `[U]` unknown
- Related pages: [browser](browser.md) · [browser research](browser-research.md)
  (the original seven-product shape study) · [the round's
  benchmarks](../benchmarks/browser-autonomy-round/)

## The eight systems on the round's axes

| System | Addressing | Failure recovery | Memory & learning (cross-session) | Auth sessions | Benchmarks |
|---|---|---|---|---|---|
| **Browser Use** (119.7k★, MIT; 0.13.14 2026-10-26 `[V]`) | DOM/a11y snapshots; vision via integrations | replay fails hard (`RuntimeError` at first mismatch `[V]`); Cloud scripts get prompted self-repair `[C]` | ✅ save/replay histories + variable detection (OSS); Cloud workspaces + rerunnable scripts `[V]` — no failure memory | system Chrome profile; Cloud profiles (cookies only) `[V]` | self-published: Stealth Bench V2 90.5%, Online-Mind2Web 98% (own judge) `[C]`; BU Bench v2.1 72.9 @ ~11¢/task `[V]` |
| **Stagehand** (Browserbase, 25.9k★, MIT; 4.3.0) | hybrid trimmed a11y tree; observe→real CSS selectors; deep iframe/shadow-DOM locators `[V]` | ✅ act/observe/extract re-resolve on change; cached replay falls back to full inference on drift `[V]` | ✅ Browserbase Cache — server-side, cross-session, on by default `[V]` — no failure memory | `userDataDir` cookie persistence; Browserbase contexts `[V]` | none first-party; 60.7% WebBench (May 2025, third-party) `[V]` |
| **Playwright MCP** (Microsoft, 38.9k★, Apache-2.0; v0.0.84 2026-10-31 `[V]`) | a11y snapshot + refs; optional vision coords | ❌ none `[V]` | ❌ none (profiles = auth state) | user-data-dir; storage-state; Chrome extension attaches to a running logged-in browser `[V]` | none first-party; 60.0 BU Bench V2.1 (third-party, most token-hungry: ~6.7M input median) `[V]` |
| **Skyvern** (23.3k★, AGPL-3.0; v1.0.56 2026-10-14) | screenshot + interactive elements per step (vision+DOM) | layout-change resistant by design (no stored selectors) `[V]` | workflows persist (human/Copilot-taught); run artifacts — no auto-reuse, no failure memory `[V]` | credential vault + 2FA; browser sessions ≤6 h; profiles `[V]` | WebBench 64.4% #2 (verified leaderboard, frozen 2025-05-30; #1 Anthropic CUA 66.0) `[V]`; WebVoyager 85.8 `[C]` |
| **agent-browser** (vercel-labs, 45.1k★, Apache-2.0; v0.41.0 2026-10-29 `[V]`) | a11y refs + CSS/XPath/text/semantic locators; ~200-400 token snapshots `[V]` | ❌ none built-in | ❌ none (state save = auth state); stateful sessions + daemon restore `[V]` | CDP attach (local/remote); provider profiles (Browser Use Cloud, Browserbase, …) `[V]` | none first-party; 56.3 BU Bench V2.1 (third-party) `[V]` |
| **Anthropic browser/computer toolset** (stable, 2026-08-01 versions) | hybrid: a11y refs `[ref_N]` + viewport coords + screenshots; batch actions with halt-on-failure `[V]` | model re-reads each turn; no persistence | ❌ (conversation state only) `[V]` | executor's concern; injection classifiers scan tool returns `[V]` | none in platform docs; third-party: 56.3% Online-Mind2Web (CUA 3.7); OSWorld 2.0 #1 (Opus 4.8, 20.6% binary) `[V]` |
| **Browserbase / Steel** (cloud infra) | n/a (provide the browser) | n/a | persistent contexts (BB) / sessions+profiles (Steel) `[V]` | contexts; proxies; dedicated IPs (Steel) | Stealth Bench V2: BB 78.5%, Steel 74.5% (Browser Use's vendor bench) `[C]` |
| **OpenAI Operator/Codex browser** | `computer_use_preview` incl. `browser` env; SDK `BrowserToolset` = client-side function tools mirroring Anthropic's members (new this quarter) `[V]` | model-driven; `browser_authentication` approval requests `[V]` | ❌ none documented `[V]` | ChatGPT-plan logins (Codex); approval flow for logins `[V]` | Operator 61.3% Online-Mind2Web (retired product, third-party); GPT-5.4 CU 92.8% self-reported-unverified `[U]` |

Release-velocity snapshot (this round's own browser sweep, 2026-11-01,
receipt `release-monitor.jsonl`): browser-use 0.13.14 (Oct 26), playwright-mcp
v0.0.84 (Oct 31 — isolated contexts, URL redaction, bounded find), stagehand
server-v3.7.7 (Oct 23 — XPath fallback for shadow roots). All three loaded
fully anonymously — no login wall on releases pages `[V]`.

## The benchmark landscape (Nov 2026)

| Benchmark | SOTA (holder) | Read |
|---|---|---|
| WebArena (812 tasks) | Narada AI Code 86.1% (closed, Sep 2026); above the human 78.24% line `[V]` | stale/self-hosted; specialists win |
| Online-Mind2Web (300 live tasks) | Hark 97.7%, Yutori n1.5 97.3% (human-graded) `[V]` | the live frontier — navigation is solved at the top |
| WebBench (5,750 tasks) | Anthropic Sonnet 3.7 CUA 66.0% (frozen 2025-05-30) `[V]` | frozen |
| OSWorld 2.0 (108 long-horizon desktop) | Claude Opus 4.8 20.6% binary / 54.8% partial; >163-min tasks: 0% for everyone `[V]` | **the 2026 bottleneck is horizon, not navigation** |
| Stealth Bench V2 (vendor) | Browser Use Cloud 90.5% `[C]` | vendor-authored sample |

The academic proof points for memory-of-workflows on WebArena: Agent
Workflow Memory 35.5%, ColorBrowserAgent 71.2% (site-specific knowledge
adaptation), AutoManual 65.1% `[V]` — double-digit gains from exactly the
mechanism class Unown ships (persisted, session-derived knowledge), while
no shipping product persists *failures*.

## Where Unown stands (the round's own receipts)

- **Addressing**: refs through shadow roots + same-origin iframes — validated
  3/3 on a hostile fixture (session log P2); the category's a11y-ref
  mainstream (Playwright MCP, Anthropic, agent-browser) matches; Stagehand
  adds real-selector observe, Browser Use adds form-state bounding.
- **Failure recovery**: the dialog auto-dismiss default is a known footgun
  (F2, issue [#45](https://github.com/kanishka-namdeo/Unown/issues/45));
  the F3 iframe fill race is fixed this round with a verify-and-retry lane
  (issue [#43](https://github.com/kanishka-namdeo/Unown/issues/43)) —
  Stagehand's "cache-miss → re-inference" is the same shape.
- **Memory**: the differentiator. Dreams v1/v2 consolidated browser facts
  into project memory inside the hour, unprompted (CP2b); recall validated,
  proactive application partial. **No competitor persists failure memory**
  (`[V]` across all eight — the closest is Stagehand's action cache, which
  stores successes, and Browser Use's replay, which hard-fails on drift).
- **Auth**: profile persistence + CDP attach parity with the category
  (`[V]` docs/browser.md); not re-validated live this round (no real
  login surface in the sandbox) — recorded as the round's honest gap.

## Adopt/reject ledger

| Idea | Source | Verdict |
|---|---|---|
| Tool-time procedural hints (surface matching browser memories at the browser tool call) | this round's F2 finding; the memory axis above | **adopt** — filed as [#45](https://github.com/kanishka-namdeo/Unown/issues/45); the round's top improvement candidate |
| Post-fill persistence verification (verify → retry once → fail loudly) | this round's F3; Stagehand's fallback-to-inference shape | **shipped this round** (probes.ts + session.ts, live-pinned) |
| Frame-inclusive readiness gate at navigate | this round's F3 repro | **shipped this round** |
| Bounded token snapshots (explicit element caps) | agent-browser's ~200-400 token snapshots | **already shipped** (UNOWN_BROWSER_SNAPSHOT_MAX_CHARS) — parity confirmed |
| Semantic locators (`find role/label/testid`) | agent-browser | **defer** — refs + CSS already cover; revisit if ref-minting noise grows |
| Screenshot extension/format reconciliation | this round's F1 | **adopt** — filed as [#44](https://github.com/kanishka-namdeo/Unown/issues/44) |
| Action-result caching (cross-session success cache) | Stagehand/Browserbase Cache | **defer with reason** — Unown's memory already carries workflow knowledge; a cache would duplicate the tier without the learning loop; reconsider if token cost on repeats becomes the bottleneck |
| Benchmark publishing on a public board (WebArena-class) | category practice | **defer** — self-hosted benchmark farms contradict the repo's receipts-in-repo policy; the round's own suites (benchmarks/browser-autonomy-round/) stay the source of truth |

## Sources (primary, fetched 2026-11-01)

github.com/browser-use/browser-use (+ /releases, docs.browser-use.com
llms.txt, browser-use.com/best-web-agents.md) · github.com/browserbase/stagehand
+ docs.stagehand.dev/v4/best-practices/caching · github.com/microsoft/playwright-mcp
(+ /releases) · github.com/Skyvern-AI/skyvern + skyvern.com/docs ·
github.com/vercel-labs/agent-browser + agent-browser.dev (+ /changelog) ·
platform.claude.com/docs (browser-use-tool, browser-use-sdk via
docs.claude.com/llms-full.txt) · browserbase.com/llms.txt + /pricing ·
github.com/steel-dev/steel-browser + docs.steel.dev · github.com/openai/codex
+ openai-python CHANGELOG + github.com/openai/openai-openapi ·
webbench.ai · osworld-v2.xlang.ai · huggingface.co/spaces/osunlp/Online_Mind2Web_Leaderboard ·
web-arena-x/webarena leaderboard CSV · unbrowse.ai (+ /llms.txt) ·
yutori.com/leaderboards
