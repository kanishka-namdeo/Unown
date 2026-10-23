# Browser — drive a real Chromium from the session

One `browser` session tool: the agent navigates, reads the accessibility
tree, clicks and types with trusted input, fills forms, watches the console
and the network, takes screenshots a vision model can see, and exports PDFs
— against a real Chromium it launches itself (or one you are already logged
into). It auto-starts on first use; there is nothing to configure.

- [What it is](#what-it-is)
- [The work loop](#the-work-loop)
- [Element addressing](#element-addressing)
- [Action reference](#action-reference)
- [Screenshots and vision models](#screenshots-and-vision-models)
- [Launch vs attach](#launch-vs-attach)
- [Profiles and logins](#profiles-and-logins)
- [Downloads and uploads](#downloads-and-uploads)
- [Environment variables](#environment-variables)
- [Cross-platform support](#cross-platform-support)
- [Security and trust](#security-and-trust)
- [What is deliberately out, v1](#what-is-deliberately-out-v1)

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
sees directly — the agnes-3.0-flash preset takes them).

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

## Action reference

| Action | Key parameters | What it does |
|---|---|---|
| `start` | `headless`, `width`, `height` | Start (or report) the browser; auto-runs on first use anyway |
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
| `eval` | `code` | Run JS in the page (expressions or async function bodies); the result is returned |
| `tabs` | `tabsAction`, `index`, `url` | `list` / `new` / `select` / `close` tabs |
| `wait` | `text`, `textGone`, `url`, `time`, `waitDownload`, `timeoutMs` | Bounded waits only — see [the work loop](#the-work-loop) |
| `resize` | `width`, `height` | Set the viewport |
| `console` | `level` | Console entries captured so far (filterable) |
| `requests` | — | Network requests seen so far (method, status, type, URL) |
| `cookies` | `cookiesAction`, `url`, `name`, `value` | `list` / `set` / `clear` |
| `upload` | `paths`, `ref`/`selector` | Set files on a file input — paths jailed to the project root and system tmp |
| `pdf` | `filename`, `landscape` | Print the page to a PDF file |
| `storage` | `storageAction`, `path` | `save` / `load` cookies + current-origin localStorage as a JSON state file |

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
| `UNOWN_BROWSER_PROFILE` | `~/.unown/browser/profile` | Persistent profile directory |
| `UNOWN_BROWSER_BLOCK` | — | Comma-separated host-glob deny list (`*.example.com,internal.corp`), checked before every navigation |
| `UNOWN_BROWSER_TIMEOUT_MS` | `30000` | Navigation timeout |
| `UNOWN_BROWSER_SETTLE_MS` | `300` | Post-action quiet settle |
| `UNOWN_BROWSER_SNAPSHOT_MAX` | `400` | Max elements per snapshot |
| `UNOWN_BROWSER_SNAPSHOT_MAX_CHARS` | `60000` | Max snapshot characters returned |

## Cross-platform support

Native on all six release targets (the same compiled binaries as the rest of
unown; the CDP client is pure protocol over Bun's WebSocket). Browser
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
  the AutomationControlled blink feature (so `navigator.webdriver` is not
  trivially true) — a real browser profile, not stealth theater. No
  anti-bot service integrations; a datacenter IP is a datacenter IP.
- **Teardown**: `Browser.close` on session end plus SIGTERM/SIGKILL fallback
  on the process tree; a crashed session never leaks a zombie Chromium.
  Attach mode only ever closes its socket.

## What is deliberately out, v1

Closed shadow-DOM piercing (`DOMSnapshot.captureSnapshot` is the paved
path), network interception (`Fetch` domain), video/HAR recording,
storage-state export beyond cookies + current-origin localStorage, and any
anti-bot service. Each has a CDP path; none blocks the five journeys — and
the scope line with its reasoning is in
[browser research §4](browser-research.md#4-scope-line-explicitly-out-v1).
