# Browser — drive a real Chromium from the session

One `browser` session tool: the agent navigates, reads the accessibility
tree, clicks and types with trusted input, fills forms, watches the console
and the network, takes screenshots a vision model can see, and exports PDFs
— against a real Chromium it launches itself (or one you are already logged
into). It auto-starts on first use; there is nothing to configure.

- [What it is](#what-it-is)
- [The work loop](#the-work-loop)
- [Element addressing](#element-addressing)
- [Stealth mode](#stealth-mode)
- [CAPTCHAs](#captchas)
- [Workflows for end users](#workflows-for-end-users)
- [Action reference](#action-reference)
- [Screenshots and vision models](#screenshots-and-vision-models)
- [Launch vs attach](#launch-vs-attach)
- [Profiles and logins](#profiles-and-logins)
- [Downloads and uploads](#downloads-and-uploads)
- [Environment variables](#environment-variables)
- [Cross-platform support](#cross-platform-support)
- [Security and trust](#security-and-trust)
- [What is deliberately out](#what-is-deliberately-out)

Related pages: [usage](usage.md) · [configuration](configuration.md) · [BEHAVIOR](BEHAVIOR.md) · [browser research](browser-research.md) · [testing strategy](testing-strategy.md)

## What it is

A coding agent that cannot use a browser cannot test what it builds, cannot
read pages that need JavaScript, and cannot fill a real form. The `browser`
tool closes that gap the same way the rest of unown works: locally, in your
project, with no cloud browser in the loop. The agent speaks the Chrome
DevTools Protocol directly over Bun's native WebSocket — there is no
Playwright, no Selenium, no new runtime dependency, and the compiled
binaries stay a closed graph.

The design was reverse-engineered from seven shipping products (Browser Use,
Stagehand v4, Playwright MCP, Skyvern, Anthropic's browser toolset,
Browserbase/Steel, vercel-labs' agent-browser); the receipts, the tool
surfaces compared, and the sixteen decisions the shape rests on are in
[browser research](browser-research.md).

Five user journeys it is built for: drive and test a local dev server;
extract data from a page that needs JavaScript; fill and submit a real form;
log in once and keep the session across runs; and visually verify a deploy
through a vision model's eyes (screenshots come back as images the model
sees directly — the agnes-3.0-flash preset takes them). Since the v2 round
two more tiers close the loop on sites that fight back: a **stealth mode**
(no CDP detection signal, a coherent fingerprint, humanized input) and a
**CAPTCHA pipeline** (detect → classify → solve → verify, with native-click,
solver-service and vision-OCR tiers) — see [stealth mode](#stealth-mode),
[CAPTCHAs](#captchas) and [the workflows](#workflows-for-end-users).

**Delegating instead of driving.** Every session can use the `browser` tool
directly — and for anything beyond a quick check you should hand the whole
flow to the **`browser` subagent** (`task {agent: "browser"}`, sync or async)
instead: the child holds the snapshots, screenshots and console noise in its
own context and returns a compact verified report (`Outcome:` / `Did:` /
`Pages:` / `Notes:`), on a 10-minute budget, with the model fallback chain.
The same Gemini-CLI/Cursor reasoning applies: DOM trees are context poison,
so the browser surface ships as a subagent. The routing contract (what to
delegate, what belongs to `webfetch` instead) lives in
[subagents](subagents.md#delegating-web-work-the-browser-subagent).

## The work loop

Every mutation returns a fresh accessibility snapshot, so the next decision
is always grounded in what the page looks like now:

```
browser navigate url=http://localhost:3000
browser snapshot                  (or just read the snapshot the navigate returned)
browser click ref=e12             (e12 came from that snapshot)
browser type ref=e14 text="hello" submit=true
browser wait text="Saved"
browser screenshot                (verify — the image comes back inline)
```

Rules the tool enforces for you: refs are invalidated by navigation —
re-snapshot instead of reusing them (a stale ref is an actionable error, not
a silent misclick); `find` greps the current snapshot when a big SPA buries
the target; `wait` supports `text`, `textGone`, `url`, a download
completing, or a bounded sleep (max 30 s) — never an unbounded "network
idle".

## Element addressing

Three address modes, accepted everywhere an element is needed (D3 in the
research record):

| Mode | Example | Use it when |
|---|---|---|
| ref | `ref=e12` | always preferred — it comes from the last snapshot |
| CSS selector | `selector=#submit` | the page is known and stable, or a ref is not in view |
| coordinates | `x=640 y=300` | the vision tier: the target has no a11y node (canvas, image maps) — pair with a screenshot |

Clicks and typing are **trusted input**: the element is scrolled into view,
then real `Input.dispatchMouseEvent` / `dispatchKeyEvent` events land at its
center. Sites that check `isTrusted` behave as if a human clicked. The
snapshot walker also mints `data-unown-ref` attributes on elements while
snapshotting, so a ref doubles as a stable selector for replay.

## Stealth mode

For sites that fingerprint and block bots. Opt in per session
(`browser start stealth=true`) or for every session
(`UNOWN_BROWSER_STEALTH=1`); the mode is set at launch — a running browser
must be stopped before switching. What it does, every piece verified live
against a real Chromium (the probes are `scripts-dev/dbg-stealth-probe*.ts`,
the assertions are `test/browser-stealth-live.test.ts`):

- **No CDP detection signal.** The Runtime domain is never enabled. The
  2026-generation detector — a page hooking `Error.prepareStackTrace` and
  console.debug-ing an error, which fires the moment a client calls
  `Runtime.enable` because Chrome starts serializing console arguments —
  stays **silent** in a stealth session and **fires** in a classic one (both
  directions are asserted by the live suite, the same detector DataDome-class
  WAFs ship). Every internal page operation (snapshots, element prep, form
  fills, captcha detection, token injection) runs in an **isolated world**
  (`Page.createIsolatedWorld`), so the page's own JS state is never touched.
- **A coherent fingerprint, applied by the browser itself — not by page-JS
  patching** (the 2026 consensus: JS-injected lies are themselves
  detectable). `Network.setUserAgentOverride` carries the full
  `userAgentMetadata` (brands, platform, platformVersion, architecture,
  mobile) so `navigator.userAgent`, `navigator.platform` and
  `navigator.userAgentData` all agree; `Emulation.setLocaleOverride` and
  `setTimezoneOverride` pin Intl; `setDeviceMetricsOverride` sets viewport
  *and screen* (the 800x600 headless default screen is a classic tell).
  The claimed Chrome version **is the launched engine's real version**
  (read from `--version`), so the client hints never over-claim.
- **Identities per OS** — `windows` (default), `macos`, `linux`
  (`UNOWN_BROWSER_OS`), each with a plausible screen/viewport/locale/timezone
  set. Running on Linux while claiming Windows leaks at the TCP layer —
  hosted-stealth-browser surveys' number one finding — so the honest `linux`
  identity is one flag away, and users on macOS/Windows hosts get native
  coherence for free.
- **Humanized input.** Mouse clicks walk a jittered, eased, seeded-PRNG
  bezier path from the cursor's last position (no straight-line teleports);
  typing lands per key with human-ish delays instead of an instant paste.
  Disable with `UNOWN_BROWSER_HUMANIZE=0`; pin the seed for reproducible
  runs with `UNOWN_BROWSER_HUMANIZE_SEED`.
- **Flag hygiene + the right binary.** Never `--enable-automation`,
  always `--disable-blink-features=AutomationControlled` (both modes), and
  stealth discovery skips the stripped `chrome-headless-shell` builds (they
  lack `window.chrome` and coherent Notification.permission).
- **Proxies.** `UNOWN_BROWSER_PROXY` (`socks5://gw:1080`, `http://gw:8080`,
  or bare `host:port`) becomes `--proxy-server` with loopback bypassed —
  your local dev server never goes through the proxy. A residential proxy
  is the single biggest factor in passing bot checks; no fingerprint fixes
  a datacenter IP.
- **Honest degradation.** Console capture is impossible without the Runtime
  domain (verified: `Log.entryAdded` carries network/browser errors only,
  and `Runtime.bindingCalled` events do not deliver without the enable), so
  in stealth mode `console` reports Log-domain entries only — the same
  tradeoff Patchright documents. `browser stealth verify` re-reads the live
  fingerprint and reports each axis (webdriver, UA, platform, client hints,
  timezone, locale, screen, viewport, plugins, window.chrome) — 10/10
  coherent in the verified baseline, and `bot.sannysoft.com` shows zero
  FAIL rows from a stealth session (the agent ran that check itself).
- **Attach mode keeps the protocol tier.** Launch flags belong to the
  browser you attach to, but the no-signal handshake, isolated worlds and
  fingerprint overrides still apply per page.

What stealth does **not** do: hide your IP (that is the proxy's job), defeat
TLS/TCP-stack OS fingerprinting (claim the OS you run, or accept the risk),
or solve interactive challenges that need a human (take over with
`UNOWN_BROWSER_HEADLESS=0`).

## CAPTCHAs

`browser captcha detect` classifies what is on the page; `browser captcha
solve` runs the pipeline for one challenge (default: the first detected).
Detection covers Cloudflare Turnstile (widget and full-page interstitial),
reCAPTCHA v2 and v3, hCaptcha, DataDome, AWS WAF, GeeTest, Arkose/FunCaptcha,
and an image-captcha heuristic (an `<img>` with captcha-ish naming next to a
text input inside a form). `navigate` re-runs detection automatically and
reports what it found; with `UNOWN_CAPTCHA_AUTO=1` it also attempts a solve.

The solve tiers, in order (each reported honestly — the result lists what
was attempted and what failed):

1. **Native click** — Turnstile / reCAPTCHA / hCaptcha checkbox widgets get
   a real trusted click at the checkbox's coordinates (input-level events
   cross iframes), then the response field is checked for a token. With a
   coherent fingerprint this is often enough for Turnstile.
2. **Solver service** — [2Captcha] or [CapSolver] (set a key:
   `UNOWN_CAPTCHA_2CAPTCHA_KEY` / `UNOWN_CAPTCHA_CAPSOLVER_KEY`; the solver
   picks whichever key exists, or pin one with `UNOWN_CAPTCHA_SOLVER`).
   Tokens are injected into the page's response fields through native
   setters + events (React/Vue-safe), and the page is re-checked. Supported:
   reCAPTCHA v2/v3, Turnstile, AWS WAF, DataDome (2Captcha), image-to-text.
3. **Vision OCR** — image captchas are clipped, screenshotted, and read by
   any OpenAI-compatible image endpoint. The default preset is this repo's
   own: **Agnes AI's `agnes-3.0-flash`** (set `UNOWN_VISION_API_KEY` or
   `AGNES_API_KEY`; verified live — the model reads a four-character
   fixture captcha and the answer lands typed in the field).

The honest gaps, stated rather than faked: **hCaptcha was dropped by every
major solving vendor as of October 2026** (2Captcha's hCaptcha page is a
404; CapSolver's API docs too) — the native click and a human takeover are
what is left. DataDome/Imperva-class interstitials are *prevention* problems
(stealth + residential proxy), not token problems; full-page Cloudflare
interstitials usually clear themselves when the fingerprint is coherent —
`wait`, then re-check. `browser captcha solve` never pretends otherwise:
the result names the tiers attempted and the reason each failed.

[2Captcha]: https://2captcha.com/2captcha-api
[CapSolver]: https://docs.capsolver.com/

## Workflows for end users

1. **Test the local dev server** — `navigate http://localhost:3000` →
   snapshot → click/type on refs → read `console` and `requests` for errors
   → screenshot to visually confirm. Stealth off; localhost is never
   proxied even in stealth mode.
2. **Scrape a JS-rendered page** — navigate → `text`/`html` (or snapshot
   refs) → for authenticated pages, log in once (workflow 4) or load a
   saved storage state (`storage load state.json`).
3. **Fill and submit a real form** — one `fill_form` call with the fields →
   `click` the submit button (or `type … submit=true`) → `wait text=` for
   the confirmation. On a protected form, start with
   `browser start stealth=true` and let the captcha tiers run.
4. **Log in once, stay logged in** — the persistent profile
   (`~/.unown/browser/profile`) keeps cookies across runs; export a
   portable state with `storage save` and reload it later; or attach to the
   Chrome you are already logged into (`UNOWN_BROWSER_CDP`).
5. **Visually verify a deploy** — `screenshot` returns the image inline, so
   a vision model (the agnes preset) reads it and grounds coordinate clicks
   when the a11y tree lacks a target.
6. **Browse a bot-protected site** — `browser start stealth=true` (+
   `UNOWN_BROWSER_PROXY` for a residential exit) → navigate → if a captcha
   is reported, `browser captcha solve` → `browser stealth verify` to
   confirm the fingerprint when something still blocks you.
7. **Image-captcha form completion** — set the Agnes key; detection finds
   the image + input pair, the vision tier reads the code, and the answer
   is typed like a human typed it.

## Action reference

| Action | Key parameters | What it does |
|---|---|---|
| `start` | `headless`, `stealth`, `width`, `height` | Start (or report) the browser; `stealth` must match the whole session; auto-runs on first use anyway |
| `stop` | — | Close the browser gracefully (also runs on session end) |
| `status` | — | Running state, executable, profile, viewport, entry counts |
| `navigate` | `url` | Open a URL (bare hosts get `https://`); waits for load + settle, returns a snapshot |
| `back` / `forward` / `reload` | — | History navigation |
| `snapshot` | `includeBoxes` | The a11y tree with `[eN]` refs (caps: 400 elements / 60k chars, with a truncation note) |
| `find` | `text` | Grep the current snapshot for matching elements — the cheap narrowing move on big pages |
| `text` / `html` | `selector` | Read the page's text (or an element's HTML) |
| `click` | `ref`/`selector`/`x,y`, `button`, `doubleClick`, `modifiers` | Click by ref, selector, or coordinates; right/middle; with held modifiers |
| `hover` | `ref`/`selector` | Hover (menus that need it) |
| `type` | `ref`/`selector`, `text`, `submit`, `clear` | Type text (cleared first with `clear`); `submit` presses Enter |
| `press_key` | `key` | A key or combo — `Enter`, `Control+a`, `cmd+shift+p` |
| `fill_form` | `fields: [{ref|selector, value}]` | Fill many fields in one call, then submit separately — one round-trip instead of N |
| `select_option` | `ref`/`selector`, `values` | Native select values/labels |
| `scroll` | `direction`, `amount`, `ref`/`selector` | Scroll the page (or an element) up/down/left/right |
| `drag` | `startRef`/`startSelector`, `endRef`/`endSelector` | Drag from one element to another |
| `screenshot` | `fullPage`, `ref`/`selector`, `format`, `quality`, `filename` | Capture the page — comes back as an image the model sees; `filename` also saves it |
| `eval` | `code`, `world` | Run JS in the page (expressions or async function bodies); `world: isolated` never touches page JS state; the result is returned |
| `tabs` | `tabsAction`, `index`, `url` | `list` / `new` / `select` / `close` tabs |
| `wait` | `text`, `textGone`, `url`, `time`, `waitDownload`, `timeoutMs` | Bounded waits only — see [the work loop](#the-work-loop) |
| `resize` | `width`, `height` | Set the viewport |
| `console` | `level` | Console entries captured so far (filterable) |
| `requests` | — | Network requests seen so far (method, status, type, URL) |
| `cookies` | `cookiesAction`, `url`, `name`, `value` | `list` / `set` / `clear` |
| `upload` | `paths`, `ref`/`selector` | Set files on a file input — paths jailed to the project root and system tmp |
| `pdf` | `filename`, `landscape` | Print the page to a PDF file |
| `storage` | `storageAction`, `path` | `save` / `load` cookies + current-origin localStorage as a JSON state file |
| `stealth` | `stealthAction` | `status` (default): the stealth + captcha config, effective identity, proxy; `verify`: live 10-axis fingerprint coherence check |
| `captcha` | `captchaAction`, `text`, `attempt` | `detect` (default): classify challenges on the page; `solve`: run the pipeline (tiers below), `text` picks the type, `attempt` narrows the tier (`native`/`service`/`vision`) |

## Screenshots and vision models

`screenshot` returns the image as an image-content block in the tool result —
any OpenAI-compatible endpoint whose model takes image input receives it
directly, no extra tool, no base64 wrangling by the model. On the agnes
preset (`agnes-3.0-flash`), the standard loop is: screenshot → the model
grounds `x`/`y` coordinates against the picture → a coordinate click lands
exactly where a visual target has no a11y node. JPEG is the default format
(smaller payloads); `format: png` when every pixel matters. When
`filename` is passed the same bytes also land on disk (project-relative
paths resolve against the session cwd).

## Launch vs attach

Default: launch. The tool finds a Chromium-family executable itself —
`UNOWN_BROWSER_PATH` if set, then system Chrome / Chromium / Edge (per-OS
paths), then the Playwright `ms-playwright` cache (a repo that has run
Playwright e2e already has one) — and starts it headless with an ephemeral
debugging port. Watch it work with `UNOWN_BROWSER_HEADLESS=0`.

Attach: point the tool at a browser that is already running —
`UNOWN_BROWSER_CDP=ws://…` (or an `http://host:port`, or bare `host:port`;
the `/json/version` discovery is done for you). The flagship use is your
real, already-logged-in Chrome started with `--remote-debugging-port=9222`:
the agent drives the session you already have instead of a fresh one.
Attach never kills your browser — teardown closes the socket only.

## Profiles and logins

The persistent profile lives at `~/.unown/browser/profile` (override:
`UNOWN_BROWSER_PROFILE`). Logins survive between runs — the "log in once"
journey. When the profile is locked because another Chromium owns it (a
second unown session), that session automatically falls back to a throwaway
temp profile and says so in its results; it never steals the lock or fights
over your cookies. Chrome 136+ refuses to debug its own default profile dir,
which is exactly why unown's profile is a separate directory it owns.

## Downloads and uploads

Downloads land in the session's project cwd, with the exact path reported in
the result; `wait {waitDownload: true}` blocks until the file is complete
(Chrome renames `.crdownload` parts mid-flight — the tool waits out the
rename). Uploads accept paths inside the project root or the system tmp
only — same jail as `view_image` — so a page cannot fish arbitrary absolute
paths out of the agent's context.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `UNOWN_BROWSER_PATH` | auto | Explicit executable path; wins over discovery |
| `UNOWN_BROWSER_CDP` | — | Attach to a running browser instead of launching (ws://, http://, or host:port) |
| `UNOWN_BROWSER_HEADLESS` | `1` | `0` runs headed — watch the agent work |
| `UNOWN_BROWSER_NO_SANDBOX` | `0` | `1` adds `--no-sandbox --disable-gpu` on the FIRST launch (containers/CI; the crash-retry path always forces them) |
| `UNOWN_BROWSER_PROFILE` | `~/.unown/browser/profile` | Persistent profile directory |
| `UNOWN_BROWSER_BLOCK` | — | Comma-separated host-glob deny list (`*.example.com,internal.corp`), checked before every navigation |
| `UNOWN_BROWSER_TIMEOUT_MS` | `30000` | Navigation timeout |
| `UNOWN_BROWSER_SETTLE_MS` | `300` | Post-action quiet settle |
| `UNOWN_BROWSER_SNAPSHOT_MAX` | `400` | Max elements per snapshot |
| `UNOWN_BROWSER_SNAPSHOT_MAX_CHARS` | `60000` | Max snapshot characters returned |
| `UNOWN_BROWSER_STEALTH` | `0` | `1` starts every browser session in stealth mode |
| `UNOWN_BROWSER_OS` | `windows` | Claimed OS identity in stealth mode (`windows` / `macos` / `linux`) |
| `UNOWN_BROWSER_USER_AGENT` | per identity | Explicit UA override (rest of the identity still applies) |
| `UNOWN_BROWSER_LOCALE` | `en-US` | Locale + Accept-Language in stealth mode |
| `UNOWN_BROWSER_TIMEZONE` | `America/New_York` | IANA timezone id (validated; invalid ids fall back to the default) |
| `UNOWN_BROWSER_SCREEN` | `1920x1080` | Claimed screen size in stealth mode (`WxH`) |
| `UNOWN_BROWSER_HUMANIZE` | `1` in stealth | `0` disables humanized mouse paths and per-character typing |
| `UNOWN_BROWSER_HUMANIZE_SEED` | random | Fixed seed for reproducible humanized-input paths |
| `UNOWN_BROWSER_PROXY` | — | Proxy for all site traffic (`http://…`, `socks5://…`, or `host:port`); loopback is bypassed |
| `UNOWN_CAPTCHA_SOLVER` | auto | `2captcha` / `capsolver` / `none`; default picks whichever key is set |
| `UNOWN_CAPTCHA_2CAPTCHA_KEY` | — | 2Captcha API key |
| `UNOWN_CAPTCHA_CAPSOLVER_KEY` | — | CapSolver API key |
| `UNOWN_CAPTCHA_AUTO` | `0` | `1` auto-solves detected challenges right after navigate |
| `UNOWN_CAPTCHA_VISION` | `1` with a key | `0` disables the vision-OCR tier |
| `UNOWN_VISION_BASE_URL` | `https://apihub.agnes-ai.com/v1` | OpenAI-compatible endpoint for image-captcha OCR |
| `UNOWN_VISION_API_KEY` | `AGNES_API_KEY` | Key for the vision endpoint |
| `UNOWN_VISION_MODEL` | `agnes-3.0-flash` | Vision model for image-captcha OCR |

## Cross-platform support

Native on all six release targets (the same compiled binaries as the rest of
unown; the CDP client is pure protocol over Bun's WebSocket — and the
stealth tier adds only protocol and launch-flag work, so it ships in the
same closed graph with zero new dependencies). Browser
discovery knows the per-OS Chrome/Chromium/Edge locations on Windows
(Program Files + LocalAppData, real backslash paths), macOS (the four .app
bundles) and Linux (the distro binary set), plus the Playwright cache layout
per OS. Windows path handling is tested with literal separators — not
`path.join` on the host OS — so the linux-built windows binary still emits
`C:\…` paths. No browser installed? The error names both install paths
(your package manager / `bunx playwright install chromium`).

## Security and trust

- **Local-first**: no cloud browser, no proxying vendor; the browser runs on
  your machine and the protocol is spoken directly.
- **Deny list**: `UNOWN_BROWSER_BLOCK` is checked before every navigation —
  localhost stays allowed by default (driving your dev server is a
  first-class use case, not an accident).
- **The jail**: uploads are limited to the project root and system tmp;
  downloads land in the cwd with the path reported.
- **Honest fingerprints**: unown never passes `--enable-automation` and drops
  the AutomationControlled blink feature in both modes. Stealth mode is
  protocol-level and self-verifying (`browser stealth verify` reports every
  axis), never JS-injection theater — and it says out loud what it cannot
  fix (your IP is your IP: `UNOWN_BROWSER_PROXY` is the lever). Solver
  keys and vision keys live in env vars, are never sent anywhere except
  their own service, and the vision tier ships only the clipped captcha
  image — never the page — to the endpoint.
- **Teardown**: `Browser.close` on session end plus SIGTERM/SIGKILL fallback
  on the process tree; a crashed session never leaks a zombie Chromium.
  Attach mode only ever closes its socket.

## What is deliberately out

The v2 round moved the anti-bot scope line: stealth mode and the CAPTCHA
pipeline are now in (above), with their design records in
[browser research](browser-research.md). Still out, each a deliberate scope
decision with a CDP path when it earns one: closed shadow-DOM piercing
(`DOMSnapshot.captureSnapshot`), network interception (`Fetch` domain —
also a stealth liability: serving the main document through `route.fulfill`
leaves an empty `nextHopProtocol`), video/HAR recording, and storage-state
export beyond cookies + current-origin localStorage. Solving *for* sites
(hCaptcha after the vendor drop, Imperva-class walls) stays out too — those
are documented as gaps, not half-implemented.
