# Browser automation research and design record

> **What this page is.** The decision record for Unown's browser automation
> capability (the `browser` session tool): what the field offered as of
> 2026-10-23, what was measured by reading each product's live documentation and
> source, and why the shipped design is shaped the way it is. Companion pages:
> [browser.md](browser.md) (the user-facing capability doc),
> [BEHAVIOR.md](BEHAVIOR.md) (where the tool sits in the default session),
> [testing-strategy.md](testing-strategy.md) (how the capability is verified).

Seven products were reverse-engineered for their tool surfaces, element models
and session semantics — from their published docs, `llms.txt` endpoints, MCP
tool listings, protocol JSON and SDK types, not from marketing pages. The
tables below cite what each actually exposes today.

## 1. The field, late 2026

| Product | Shape | Element model | Driver |
|---|---|---|---|
| Browser Use 0.13 (Python) | agent library + cloud | indexed DOM elements (index numbers painted on page), vision optional | CDP direct (V4 dropped Playwright) |
| Stagehand v4 4.3 (TS/Py/Go) | `act`/`extract`/`observe` SDK | trimmed a11y tree in, **XPath** out (cached, replayed) | CDP direct (no Playwright page interop) |
| Playwright MCP 0.0.83 | MCP server, ~25 tools | **ariaSnapshot YAML + refs** (`browser_snapshot`, `browser_find`), CSS selectors accepted, coords opt-in | Playwright (in-monorepo), CDP attach modes |
| Skyvern (Python, AGPL) | server + visual Studio + 118-tool MCP | screenshot + interactive-element XPaths per step | Playwright (SDK extends it) |
| Anthropic `browser_toolset_20260801` | protocol, 31 named actions | a11y tree with `[ref_N]`, 50k-char read cap, coordinate tier | you implement the driver |
| Browserbase / Steel | cloud infra | n/a (they host the browser; Live View URLs) | CDP endpoint to their sessions |
| agent-browser (vercel-labs) | CLI for coding agents | `snapshot -i` → `@eN` refs, `wait --text/--url/--load` | CDP direct |

Five convergent findings drove the design:

1. **The serious agents all dropped Playwright from the agent loop and drive
   CDP directly** (Browser Use V4 and Stagehand v4 both state this outright).
   A coding agent that already owns a WebSocket client needs no browser
   driver dependency; the ~25 CDP domains used here cover navigation, input,
   screenshots, cookies, network, downloads, tabs and dialogs.
2. **The a11y-tree snapshot with per-element refs is the dominant element
   model**, with three address modes accepted everywhere: ref (from the
   snapshot), CSS selector, and x/y coordinates (the vision tier). Anthropic's
   `read_page` caps at 50k chars and expects `find` for narrowing — the same
   shape Playwright MCP ships as `browser_find`.
3. **Tool results that carry images are the vision tier.** The model receives
   the screenshot as an image block and grounds coordinates against it
   (OpenAI CUA `computer_call`/`computer_call_output`, Anthropic
   `computer_20251124`). Unown's `ImageContent` tool-result path already
   round-trips to any OpenAI-compatible endpoint whose model takes image
   input — verified in `pi-repo/packages/ai/src/api/openai-completions.ts`
   (tool-result image blocks become `image_url` data URLs).
4. **Real-Chrome attach is a flagship feature everywhere** (Browser Use CLI,
   Skyvern `cdp-connect`, Playwright MCP `--cdp-endpoint`, Stagehand
   `localBrowser.connect`): agents want the user's already-logged-in browser.
   Unown therefore speaks plain CDP URLs for both directions (launch or
   attach) with no vendor in between.
5. **The single most-praised UX affordance across products** (Playwright MCP
   `--codegen`, Skyvern `skyvern_script_get_code`, Browserbase script
   generation): every action the agent takes should be replayable. The
   `browser` tool reports each action as the CDP-equivalent one-liner in its
   result so runs are auditable and re-runnable.

## 2. Product-by-product notes

### Browser Use (browser-use/browser-use, 0.13.11)

Agent loop with an event bus (`TIMEOUT_ClickElementEvent`,
`TIMEOUT_FileDownloadedEvent`, ...). Element model: interactive elements
extracted with index numbers, optionally painted on the page
(`highlight_elements`). Bounded waits, not strict idle:
`minimum_wait_page_load_time=0.25`, `wait_for_network_idle_page_load_time=0.5`,
`wait_between_actions=0.1`. `sensitive_data` substitutes secrets at execution
so the model never sees them. Sells a Python agent — the TS SDK is cloud-only.
Weakness for Unown's purposes: Python core, DOM+vision token weight, cloud
upsell.

### Stagehand v4 (browserbase/stagehand, 4.3.0)

`act(instruction)`, `observe` (returns actions), `extract(schema)` with
deterministic replay of cached actions; v4 drives CDP directly and merges
iframe + closed-shadow-DOM trees into snapshots by default. Actions carry
`variables` (secrets substituted server-side). Weakness: one LLM inference per
uncached `act`, Browserbase-only caching/gateway, hard v4 migration break.

### Playwright MCP (microsoft, 0.0.83 — now in the Playwright monorepo)

The reference tool surface: `browser_snapshot` (ariaSnapshot YAML with refs),
`browser_click{element, target}` (ref **or** selector), `browser_find` (grep
the snapshot — the cheap answer to 200-node SPAs), `browser_wait_for{time ≤30,
text, textGone}` (no network-idle wait — deliberate), tabs, console, network
requests, `browser_file_upload`, `browser_fill_form`, `--caps` gates for
pdf/vision/network/storage/devtools/testing. Headed **by default** so users
can watch; `--cdp-endpoint` and `--extension` attach to the user's real
browser; `--user-data-dir` persists logins. Weaknesses: refs go stale after
navigation (must re-snapshot), `browser_run_code_unsafe` is an RCE hatch,
Node + browser download required.

### Skyvern (skyvern-ai, AGPL-3.0)

Screenshot + XPath per step over Playwright; visual Studio; credential vault
with Bitwarden + TOTP; 118-tool MCP. `cdp-connect` to the real Chrome. Weakness
for embedding: heavyweight server + DB, per-step vision cost, AGPL.

### Anthropic browser toolset (`browser_toolset_20260801`)

31 named actions (`navigate`, `read_page{depth, filter, ref}`, `find`,
`left_click{target: ref|coordinate}`, `form_input`, `file_upload`,
`read_console`, `read_network`, `javascript_exec`, tabs, `wait`). Refs are
tab-scoped and go stale after navigation; `read_page` caps at 50k chars; the
dangerous four (`javascript_exec`, `file_upload`, `read_console`,
`read_network`) default OFF in their harness; the SDK's `tool_runner` +
`LocalFilePolicy(upload_roots)` jail uploads. It is a protocol, not a driver —
Browser Use ships a Python implementation. Unown's action vocabulary below
follows these names where they are already standard.

### Browserbase / Steel

Hosted CDP: sessions with Live View (watch and take control), contexts/
profiles for persisted state, residential proxies, CAPTCHA solving, files
API. Relevant here only as evidence that attach-over-CDP is the interop
standard; Unown stays local-first.

### agent-browser (vercel-labs)

CLI UX reference: `snapshot -i` prints interactive elements with `@eN` refs;
`wait --text X | --url Y | --load networkidle | --fn expr`; `state save/load`
auth.json; `--cdp 9222`. Confirms the action grammar a terminal user already
knows.

## 3. Design decisions for Unown

| # | Decision | Grounding |
|---|---|---|
| D1 | One `browser` tool with an `action` enum (27 actions), not 27 tools | Anthropic ships one toolset with named members; Browser Use ships one tool. Keeps Unown's tool list (21 today) from doubling; models already route on enum values reliably |
| D2 | CDP over Bun's native WebSocket, zero new runtime deps | finding 1 (Browser Use V4, Stagehand v4); keeps the compiled-binary artifact graph closed |
| D3 | A11y snapshot + refs as the primary tier; selector and x/y accepted everywhere | finding 2; three address modes match Playwright MCP's `target` semantics |
| D4 | `data-unown-ref` attributes minted during snapshot double as stable selectors | the attribute is readable by every CSS engine, survives the frame the JS ran in, and enables highlight-free replay |
| D5 | Trusted input: clicks/keys via `Input.dispatchMouseEvent`/`dispatchKeyEvent` at element center (after scrollIntoView), not synthetic DOM events | `isTrusted` checks on real sites; the CUA tier does exactly this |
| D6 | Screenshots return `ImageContent` (and are saved under `.unown/browser/`) | finding 3; Agnes flash models take image input — the vision loop needs no extra tool |
| D7 | Bounded waits only: `load` event + settle after navigate; text/textGone/url/time waits; no raw network-idle action | Playwright MCP's deliberate omission of network-idle; Browser Use's bounded 0.5s quiet |
| D8 | Launch **or** attach (`UNOWN_BROWSER_CDP`), auto-start on first use, headless by default, `UNOWN_BROWSER_HEADLESS=0` to watch | finding 4; coding agents mostly run headless on servers, humans flip to headed to debug |
| D9 | Persistent profile at `~/.unown/browser/profile` by default (logins survive), per-process temp dir when the profile is locked (two concurrent sessions) | Playwright MCP `--user-data-dir`, Stagehand `userDataDir`, Chrome 136+ refuses debugging the default profile dir |
| D10 | `UNOWN_BROWSER_BLOCK` host-glob deny list, checked before navigation | Browser Use `prohibited_domains`, Playwright MCP `--blocked-origins`; local-first means localhost stays allowed (testing the dev server is a first-class use case) |
| D11 | javascript eval, upload, console and network reads stay ON for the terminal agent (it is a dev tool, not a hosted sandbox); uploads jailed to project root + tmp like `view_image` | Anthropic defaults them off for hosted harnesses; Unown's terminal agent already runs arbitrary bash |
| D12 | Downloads land in the project cwd with the exact path reported in the result; `wait {download:true}` waits for completion | Browser Use `accept_downloads`, Playwright MCP `--output-dir` |
| D13 | `find` action greps the snapshot (cheap narrowing for big pages); snapshot caps at 400 elements / 60k chars with an explicit truncation note | Anthropic 50k read cap + `find`; Playwright MCP `browser_find` |
| D14 | Browser discovery order: `UNOWN_BROWSER_PATH` → system Chrome/Chromium/Edge (per-OS paths) → Playwright's `ms-playwright` cache (chromium + chrome-headless-shell) → actionable error with two install commands | both ecosystems' launchers; the repo's own e2e already ships a Playwright chromium |
| D15 | Cleanup is graceful: `Browser.close` on session shutdown, SIGINT/SIGTERM/exit hooks, process-tree fallback kill | zombie Chrome is the loudest complaint in every product's issue tracker |
| D16 | No anti-bot stealth beyond not passing `--enable-automation` + `--disable-blink-features=AutomationControlled` (a real fingerprint, not a datacenter IP, is what matters) | research §9; honesty over stealth theater |

## 4. Scope line (explicitly out, v1)

Closed shadow-DOM piercing via `DOMSnapshot.captureSnapshot` (open shadow
roots and same-origin iframes work; cross-origin frames surface as labeled
inert nodes), network interception (`Fetch` domain), video/HAR recording,
storage-state export beyond cookies + current-origin localStorage, and any
anti-bot service integration. Each has a CDP path already paved; none blocks
the five target user journeys: (1) drive/test a local dev server, (2) scrape
or extract from a page behind JS, (3) fill and submit real forms, (4) log in
once and keep the session (persistent profile), (5) visually verify a deploy
with screenshots through a vision model.
