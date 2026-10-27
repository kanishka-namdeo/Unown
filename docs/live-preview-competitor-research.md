# Live-preview & verification: what 5+ similar products actually ship

> **What this page is.** Source-level reverse engineering of how comparable AI
> coding-agent products (a) showcase agent-built apps live on their marketing
> pages, (b) verify built apps in real browsers, and (c) structure demo mode vs
> real usage. Written for the 2026-10-27 "test like a real user" round that must
> take Unown's landing live preview beyond the v0.0.33 Sigil Focus band. Every
> claim below was read out of cloned source (`/home/z/my-project/research-sources/`)
> or a fetched production page, with the file path or URL cited. Companion pages:
> [landing-research](landing-research.md) (page design), [browser-research](browser-research.md)
> (browser tool design), [testing-strategy](testing-strategy.md).

## 1. The field, at source level

| Product | Live preview of agent-built app on landing | Browser verification of built apps | State/persistence in embedded demos | Demo mode vs real usage |
|---|---|---|---|---|
| **bolt.new** (stackblitz-labs/bolt.new) | The app *is* the landing: index route renders the chat immediately. Agent output runs **inside the browser** via WebContainers (`WebContainer.boot`), dev server listens in-page, `webcontainer.on('port')` yields the preview URL, rendered in a plain `<iframe src={baseUrl}>` with an address bar locked to baseUrl paths | No server-side browser at all — "verification" is the human watching the in-page preview + terminal. No Playwright in the agent loop | **IndexedDB** (`boltHistory`/`chats`) stores full message lists; files are re-materialized by replaying artifact actions; WebContainer FS is client-side only | No separation — one product surface; anonymous free tier is the demo |
| **OpenHands / Agent Canvas** (All-Hands-AI/OpenHands) | No live app preview on marketing; the agent's browser activity is shown in-app as **base64 PNG screenshots** (`BrowserPanel`), not a live iframe/VNC | Agent-server ships a browser tool set, toggled by `VITE_ENABLE_BROWSER_TOOLS`; verified via 3 Playwright lanes: **live** (real LLM, full stack, asserts `waitForSuccessfulBashObservation`), **mock-LLM** (Python `TestLLM`, no credentials), **component stories** | Demo mode is **MSW** (Mock Service Worker) with seeded fixtures; **recorded event-stream fixtures** (`TABLE_DEMO_EVENTS`, `CANVAS_DEMO_EVENTS`, `home-automations-demo`) replay a real session through the real UI — zero server state | `VITE_MOCK_API=true` flips the whole app between mocked demo and real backends; the app also ships as an **embeddable component library** (`AgentServerUIProviders`) |
| **opencode** (sst/opencode) | None on the marketing site (Astro docs site); historical `opencode share` session pages were **discontinued** (`packages/function/src/share.ts` is a tombstone page) | `@opencode/plugin-browser`: server owns tools/permissions, desktop owns tabs+CDP+captures; snapshot/find/evaluate/wait/screenshot/click/fill, console + network.list/get, trace/cpu/heap analysis, lighthouse audits; hidden until a desktop browser attaches | Stories package: plain Vite page renders one production component with **fixed fixture data** (mock app context replaces server/router/project); Playwright mounts stories by ID | `packages/stories` component lab (fixture-driven) vs `packages/app/e2e` (full app + mock server + mock PTY harness) |
| **aider** (Aider-AI/aider) | Landing demos are **asciinema recordings of real sessions** ("aider building aider"), recorded with `asciinema rec -c "tmux attach"` and **redacted** by `scripts/redact-cast.py` (pyte terminal emulator detects sensitive UI frames and strips them); browser-UI demo is an mp4 embed | No agent browser tool. `aider --browser` launches a **Streamlit GUI** (`aider/gui.py`); Playwright is used for web scraping, and the benchmark harness verifies work by running unit tests (Exercism polyglot) per attempt | n/a (recordings are static casts; the player ships as a local asset) | Demo = recorded + redacted casts with commentary; real = CLI |
| **pi** (earendil-works, Unown's base) | None — pi.dev is a static landing; no demos | **No browser tool at all** (only `utils/open-browser.ts` to open a login URL); verification is the `test/suite` faux-provider harness | n/a | RPC mode + SDK for embedding; Unown's browser tool and live demo are Unown additions |
| **v0** (vercel, closed source — inspected live) | `/templates` (the community showcase) embeds each generated app as a **live iframe of its own Vercel deployment**: `<iframe src="https://…vercel.app" title="Template deployment preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" allow="fullscreen; camera; microphone; clipboard-write">`; OG images generated at `/chat/api/og/t/{id}`; the landing itself uses `<video>` (11 of them), zero iframes | In-app generation preview (auth-gated, not inspectable); deployed apps are real Vercel deployments | Each template is a **separate stateless deployment**; no shared state with the landing | Templates gallery (curated deployments) vs the chat product |
| *Reference points* | factory.ai (Droid): 1 `<video>`, no iframes. devin.ai: screenshots only on landing, session playthroughs behind login. sweep.dev: domain dead (archived product). | | | |

## 2. Mechanisms worth stealing, with sources

### 2.1 bolt.new — the whole dev environment in the page

- `app/lib/webcontainer/index.ts`: `WebContainer.boot({ workdirName: WORK_DIR_NAME })`
  client-side only (SSR exports a noop promise). Everything the agent builds runs
  in the visitor's browser.
- `app/lib/runtime/message-parser.ts`: the LLM streams `<boltArtifact>` /
  `<boltAction type="file"|"shell">` tags; the parser emits actions **while
  streaming** so files appear before the message finishes.
- `app/lib/runtime/action-runner.ts`: serial action queue; file actions write to
  the WebContainer FS; shell actions `webcontainer.spawn('jsh', ['-c', cmd])`.
  `npm run dev` is just another shell action.
- `app/lib/stores/previews.ts`: `webcontainer.on('port', (port, type, url) => …)`
  maintains `PreviewInfo { port, ready, baseUrl }` — **the preview only mounts
  when the port opens**, i.e. when the dev server is actually listening.
- `app/components/workbench/Preview.tsx`: plain `<iframe src={baseUrl}>`; the
  address bar's `validateUrl` **rejects any URL outside `baseUrl`** (only `/`,
  `?`, `#` continuations allowed) — an honest URL display that also cannot
  navigate away. Reload button is literally `iframe.src = iframe.src`. No
  `sandbox` attribute (the WebContainer origin is a sandboxed localhost already).
- `app/entry.server.tsx` (lines 71–72): sets `Cross-Origin-Embedder-Policy:
  require-corp` and `Cross-Origin-Opener-Policy: same-origin` on **every**
  response — WebContainer needs `SharedArrayBuffer` → cross-origin isolation.
  Verified live: bolt.new serves exactly these headers plus
  `content-security-policy: frame-ancestors 'self'; object-src 'none'`.
- `app/lib/persistence/db.ts`: IndexedDB `boltHistory` → `chats` object store,
  `urlId` index for shareable ids; whole chats (messages) are the durable state
  and files are rebuilt from them.
- `app/routes/api.chat.ts` + `functions/[[path]].ts`: the only server is a thin
  Cloudflare Pages function proxying the LLM stream (`SwitchableStream` re-requests
  with a CONTINUE_PROMPT when the model hits max tokens).

### 2.2 OpenHands Agent Canvas — demo mode as a first-class build flag

- `package.json`: `dev:mock` / `build:mock` set `VITE_MOCK_API=true`; a test
  comment states this is *"how the automations UI is developed and demoed"*.
- `src/mocks/` (MSW): per-service handlers (conversation, automations, workspaces,
  MCP, auth, files, secrets, git…). `src/mocks/should-start-mock-worker.ts` gates
  on `VITE_MOCK_API === "true"` + `typeof window`.
- `src/fixtures/canvas-demo-conversation.ts`: a canned **event stream** (typed
  `OpenHandsEvent[]` — message/action/observation events with timestamps) that
  models "an agent creating a Markdown artifact so mock mode can demonstrate
  chat-to-drawer file navigation **without an LLM**". Same shape for
  `table-demo-conversation.ts` and `home-automations-demo.ts` (a scripted
  COMPLETED/FAILED/CANCELLED pattern for status chips). This is the cleanest
  "demo = replay a recorded session through the real UI" implementation found.
- `playwright.live.config.ts`: boots the **full stack** as the Playwright
  `webServer` (`npm run dev:minimal`), 1 worker, 180s timeout, video
  `retain-on-failure`; the spec creates a conversation through the UI and waits
  for `waitForSuccessfulBashObservation` / `waitForAgentReply` / masked
  artifacts — real-browser verification of a real agent turn.
- `playwright.mock-llm.config.ts`: three-process CI lane — Python mock LLM
  (`openhands-sdk` TestLLM) + the production `agent-canvas` binary behind **one
  ingress port** routing `/api/automation/*`, `/api/*`, `/sockets`, `/*`; *"no
  real LLM credentials are needed"*.
- `src/components/features/browser/browser.tsx`: the agent's browser is rendered
  as a **data-URL PNG screenshot** in a chrome-bar frame (`url` + `screenshotSrc`
  in a zustand store) — cheaper and safer than live VNC/iframe, works on mobile.
- `scripts/vercel-install.sh`: rewrites `git+ssh://git@github.com/` →
  `git+https://` in package-lock before `npm ci` because *"Vercel's build
  environment has no SSH key … producing the dreaded `[MISSING_EXPORT]` at
  bundle time"*. A documented Vercel-deployment pitfall with an issue link.
- `src/lib/index.ts` + `build:lib`: the entire canvas UI ships as an npm library
  (`AgentServerUIProviders`, browser panel, conversation, terminal) so a host app
  can embed the agent UI — "demo mode" via embedding rather than screenshots.

### 2.3 opencode — component stories, a discontinued share page, and a CDP browser plugin

- `packages/stories/playwright/README.md` + `story.ts`: a "story server" (plain
  Vite page) renders **one production component with fixed data**; the Playwright
  `story` fixture mounts by id (`/?id=…`), waits for `#story-root`. *"without
  booting the app, configuring a server, seeding browser storage, or navigating
  unrelated routes."* Component tests are a separate CI leg from full-app e2e.
- `packages/function/src/share.ts`: the share feature is a **tombstone** —
  "Session sharing has been discontinued" (the session renderer survives as
  `packages/session-ui`). Lesson: public pages that expose agent sessions are a
  long-term liability (secrets, moderation, cost).
- `packages/plugin-browser/README.md`: browser verification toolset — *"the
  server owns tools, invocation scope, and permissions; the desktop owns tabs,
  CDP, captured traffic, evaluations, and capture files"*; operations include
  `snapshot`, `find`, `evaluate`, `wait`, `screenshot`, `click`, `fill_form`,
  `console`, `network.list/get`, `trace.start/stop/analyze`, `cpu`, `heap.*`,
  `lighthouse`. The plugin is **hidden until a desktop browser attaches**.
- `packages/app/e2e/AGENTS.md`: e2e law — shared harness (`app.ts`,
  `workspace.ts`, `mock-server.ts` with `mockServers` and a **mock PTY**), keeper
  suites per area, *"NEVER use waitForTimeout … Wait for the specific UI state,
  request, response, event, or application outcome"*, exact-identity assertions.

### 2.4 aider — recorded, redacted, replayed

- `scripts/tmux_record.sh`: `asciinema rec -c "tmux attach -t 0 -r" --headless
  --tty-size $TMUX_SIZE` — recordings of real work sessions.
- `scripts/redact-cast.py`: replays each cast through a **pyte terminal
  emulator**, tracks what is on screen, and **drops frames where sensitive UI is
  visible** (their example: the Atuin history popup). A redaction pass over raw
  recordings is mandatory before anything ships to a public page.
- `aider/website/docs/recordings/index.md`: "screen recordings of aider building
  aider … contain commentary" — the demo *is* the product being developed on
  itself, which is also Unown's storyline.
- `aider/gui.py`: `--browser` runs a Streamlit GUI locally (not a marketing
  demo); `benchmark/benchmark.py` verifies agent work the test-driven way
  (Exercism polyglot, unit tests per attempt, CSV leaderboards).

### 2.5 v0 — the landing pattern for a Vercel-hosted showcase

Production markup of a template page (`v0.app/templates/1o9ZJQxDtU4`):

```html
<iframe src="https://immersive-web-sdk-starter-app.vercel.app"
        title="Template deployment preview" class="size-full"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        allow="fullscreen; camera; microphone; clipboard-write">
```

- Each showcased app is a **real, standalone deployment**; the landing embeds it
  with a sandbox + permissions policy; the OG image is generated per template
  (`/chat/api/og/t/{id}`). The landing's own hero uses `<video>`s, not iframes —
  live embeds are used where the visitor can interact, video where they only
  need to be convinced.

## 3. Top 5 lessons for Unown's landing live preview

1. **Keep the v0 iframe contract and add a "gallery" of real routes.** Unown's
   current band already matches v0's sandbox set
   (`allow-scripts allow-same-origin allow-forms allow-modals allow-popups`).
   v0's incremental move for us: more than one agent-built artifact, each on its
   own route/deployment, surfaced as a small template gallery with a per-app
   generated OG image (`/chat/api/og/t/{id}` equivalent) — and keep bolt.new's
   **address-bar honesty**: show the real `unown…vercel.app/demo` URL and reject
   navigation outside the demo origin, plus a reload button
   (`iframe.src = iframe.src`) next to the existing reset.

2. **Make demo mode a build flag with recorded fixtures through the real UI
   (OpenHands pattern).** `VITE_MOCK_API`-style flag + event-stream fixtures
   (their `CANVAS_DEMO_EVENTS`) = the same components render a recorded unown
   session with zero model calls. Unown already has both halves —
   `session-replay.tsx` and the tui-capture pipeline — so a fixture file that
   both the replay band and the e2e specs consume closes the loop and makes the
   demo testable end-to-end.

3. **Gate the preview on readiness, not on scroll alone (bolt.new's `port`
   event).** bolt.new mounts the iframe only when the dev server's port opens.
   Unown equivalent: the `/demo` route should expose a boot/ready signal (a
   `postMessage("sigil-ready")` on load, or a HEAD-able `/demo/api/health`) and
   the landing swaps poster→frame on that signal — this also gives the e2e spec
   a deterministic wait (opencode rule: never sleep, wait for the event).

4. **Persistence: seeded state + visible reset + demo-data version key.**
   bolt.new rebuilds state from recorded messages; v0 templates are stateless
   deployments; Unown's localStorage + postMessage reset handshake is the right
   hybrid. Add a `demoDataVersion` in the seed so improved seed data ships to
   returning visitors, and keep the server routes read-only/best-effort
   (agent-canvas demo mode has *no* server state — nothing to poison or abuse).

5. **Verify the demo itself in a real browser, in CI, with three lanes
   (OpenHands' live / mock-LLM / stories, opencode's harness law).** Cheapest
   high-value lane: a Playwright spec that visits `/`, scrolls to the band,
   asserts the poster, mounts the iframe, drives it (drag a card, start the
   timer), clicks reset, and asserts the seeded state returned — plus a
   screenshots lane like opencode's `e2e/screenshots/`. This is exactly the
   "test like a real user" bar the parent task sets.

## 4. Risks and pitfalls, documented in the wild

- **Hydration (React #418).** Unown's `src/app/demo/page.tsx` already documents
  the fix: read `?embed=1` server-side and pass it down as a prop. OpenHands
  bans `localStorage` and browser globals outright in unit suites
  (`docs/DEVELOPMENT.md`); opencode bans wall-clock waits.
- **iframe sandbox + same-origin.** `allow-scripts allow-same-origin` together
  on a **same-origin** iframe effectively disables sandbox isolation —
  acceptable only because the framed content is first-party (both v0 and Unown
  ship exactly this set). bolt.new ships no sandbox at all because WebContainer
  URLs are pseudo-localhost origins, and adds CSP `frame-ancestors 'self'` so
  nobody else can frame them.
- **COOP/COEP (only if WebContainers were ever considered).** WebContainer
  requires `Cross-Origin-Embedder-Policy: require-corp` +
  `Cross-Origin-Opener-Policy: same-origin` site-wide (webcontainers.io
  "Configuring Headers"), which breaks any non-CORP third-party resource —
  analytics, fonts, embeds — on a marketing page. Do not put WebContainers on
  the landing; the separate-deployment iframe (v0) avoids the entire class.
- **Browser support.** WebContainers: Chromium + Safari 16.4+ + Firefox, all
  requiring cross-origin isolation; bolt.new even ships a middleware that blocks
  Chrome 129 specifically (`vite.config.ts` `chrome129IssuePlugin` — a Vite
  module-loading bug). The v0-iframe pattern has no such constraints.
- **Mobile.** v0, factory.ai and devin.ai all fall back to video/images; Unown's
  poster + "tap to try it live" link below `sm` is the field-standard answer.
- **Public session/share pages are a liability.** opencode discontinued theirs
  (tombstone in `packages/function/src/share.ts`); aider's pipeline exists
  specifically to **redact** recordings before publishing (pyte-based
  `redact-cast.py`). Any Unown showcase that replays a real session needs the
  same redaction gate.
- **Vercel build pitfalls.** OpenHands' `scripts/vercel-install.sh` documents
  npm rewriting GitHub deps to `git+ssh` (unclonable on Vercel →
  `[MISSING_EXPORT]` at bundle time) and fixes it by rewriting to https before
  `npm ci`. Relevant if Unown ever vendors a git dependency.

## 5. Source index

Clones live in `/home/z/my-project/research-sources/` (bolt.new, OpenHands,
opencode, aider; pi is the vendored `Unown/pi-repo`). Key upstream files:

- bolt.new — `app/lib/webcontainer/index.ts`, `app/lib/stores/previews.ts`,
  `app/components/workbench/Preview.tsx`, `app/lib/runtime/action-runner.ts`,
  `app/lib/runtime/message-parser.ts`, `app/lib/persistence/db.ts`,
  `app/entry.server.tsx`, `app/routes/api.chat.ts`, `vite.config.ts`
  (https://github.com/stackblitz-labs/bolt.new)
- OpenHands Agent Canvas — `playwright.live.config.ts`,
  `playwright.mock-llm.config.ts`, `src/mocks/handlers.ts`,
  `src/fixtures/canvas-demo-conversation.ts`,
  `src/fixtures/home-automations-demo.ts`,
  `src/components/features/browser/browser.tsx`, `src/lib/index.ts`,
  `scripts/vercel-install.sh`, `docs/DEVELOPMENT.md`
  (https://github.com/All-Hands-AI/OpenHands)
- opencode — `packages/stories/playwright/README.md`,
  `packages/stories/playwright/story.ts`, `packages/plugin-browser/README.md`,
  `packages/function/src/share.ts`, `packages/app/e2e/AGENTS.md`
  (https://github.com/sst/opencode)
- aider — `aider/website/docs/recordings/index.md`,
  `aider/website/docs/usage/browser.md`, `scripts/redact-cast.py`,
  `scripts/tmux_record.sh`, `aider/gui.py`, `benchmark/benchmark.py`
  (https://github.com/Aider-AI/aider)
- v0 — live pages inspected: https://v0.app (landing, `<video>` only),
  https://v0.app/templates, https://v0.app/templates/1o9ZJQxDtU4 (deployment
  iframe). Closed source.
- WebContainers docs — https://webcontainers.io/guides/configuring-headers,
  https://webcontainers.io/guides/browser-support
- Reference landings checked: https://factory.ai (video), https://devin.ai
  (screenshots), https://sweep.dev (dead), https://pi.dev (static),
  https://bolt.new (headers verified with curl)
