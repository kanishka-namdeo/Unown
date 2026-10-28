# The Carving Round — Session Record

The working log for the 2026-10-28 round that answers the brief *"what effects,
animations, elements can we include to make the landing page stunning and
intuitive for the end user?"* — one round after the presence round shipped its
eight, so this round ships the remainder that survives the same contracts.
Kept as a resumable record: each checkpoint states what is done, what is
verified, and what is next, so an interrupted session can resume from the last
green state. A checkpoint is only marked DONE with its measured numbers; the
rest stay open.

The research grounding for every decision is
[`docs/landing-carving-research.md`](landing-carving-research.md); the shipped
contracts live in
[`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md).

The round ships (v0.0.37): glyph draw-on for the alphabet decode panel and the
finale spellbox (the `Glyph` component's unwired `reveal` hook, driven by a new
`DrawGlyph`), the decode fill on the finale lead (scroll-scrubbed, color-only,
AA at every frame), keycap chips for the Konami affordances, the copy buttons'
"Copied" status announcement, and balanced section-heading wrapping.

---

## Checkpoint 0 — setup (DONE)

- Cloned `kanishka-namdeo/Unown` at `8e69ce5` (post-v0.0.36, the presence
  round), `bun install` clean (400 packages).
- Bun upgraded 1.3.14 → 1.4.4 (pi-repo's lockfileVersion 3 requires >= 1.4).
- Dev server boots on :3000 (`bun run dev`); `/` and `/blog` answer 200.
- Read the full contract chain before touching anything: root `AGENTS.md`,
  `src/AGENTS.md`, `src/components/landing/AGENTS.md` (+ its media/scripts
  references), `docs/landing-effects-research.md`,
  `docs/presence-round-session.md`, `CHANGELOG.md` (release line + format),
  the landing implementation surface (all band components, `landing.css`,
  `effects.tsx`, `shell.tsx`, `page.tsx`, the e11 specs' mechanics).
- Environment pinned: the Agnes AI endpoint (apihub) is the inference/VLM lane
  (`.env` carries `VLM_*` per the root AGENTS.md user preference); the GitHub
  PAT lives only in the git remote, never in a file.

## Checkpoint 1 — research (DONE)

- Two parallel online research passes (effects; intuitiveness elements) over
  the 2025–2026 catalogs (Magic UI, Aceternity, 21st.dev, motion.dev), the
  shipped markup of ~25 dev-tool landings, NN/g motion research, WCAG 2.1/2.2
  criteria and MDN/web.dev Baseline data. Findings and citations:
  `docs/landing-carving-research.md`.
- Shortlist that survives the four motion invariants AND does not duplicate
  the presence round: glyph draw-on (×2 wirings), the decode fill, kbd chips,
  the "Copied" announcement, `text-balance` on section headings.
- Re-verified as already shipped (recorded, not re-opened): anchor scroll
  offsets on every section; benchmark receipt links.
- Rejected with reasons: CRT scanlines (reconfirmed against the TFT-panel
  rule), nav hover-scramble (the pixel-font zero-CLS contract), shimmer/conic
  borders (second light-sweep language), split-flap (CountUp owns numbers),
  interactive grid cells (the spotlight owns the pointer), meteors (autonomous
  sky), word-rotator subhead (load-bearing), the seal's eye blink (the games'
  Unown never blinks), cmd-K search + blog hover-previews (next-round
  candidates, recorded at the head of the queue).
- `docs/landing-research.md` gained the dated section "2026-10-28 — the
  carving round"; the TOC links it.

## Checkpoint 2 — implementation (DONE)

File map (one effect per concern; effects in `effects.tsx`, styles in
`landing.css`, wiring in the owning band):

| Change | File(s) |
|---|---|
| `useGlyphReveal` + `DrawGlyph` (pure `glyphRevealAt` exported) | `src/components/landing/effects.tsx` |
| decode-panel glyph → `DrawGlyph` | `src/components/landing/alphabet.tsx` |
| spellbox glyphs → `DrawGlyph` | `src/components/landing/finale.tsx` |
| `.ink-fill` decode fill + `SectionHead`'s `decode` prop (`INK_FILL_MAX = 8`) | `src/app/landing.css` + `src/components/landing/shell.tsx` |
| `.gb-kbd` keycap chips (hint + receipt lines) | `src/app/landing.css` + `alphabet.tsx` + `finale.tsx` |
| "Copied" `role="status"` region | `src/components/landing/shell.tsx` (`CopyButton`) |
| `text-balance` on the section H2 | `src/components/landing/shell.tsx` (`SectionHead`) |
| unit tests | `src/components/landing/__tests__/carving.test.tsx` (15 tests) |

Gates green at this checkpoint: `bun run typecheck`, `bun run lint` (0 new
findings — the 3 pre-existing `scripts-dev/` warnings untouched), `bun test
src` (374 pass — 359 baseline + 15 new), `bun run test:coverage` (100/89/100/100%
on the four touched files, gate floor 80%), `check:changelog|blog|benchmarks|
claims`, `gba_palette_check.mjs` (21+21 tokens AA in both schemes),
`landing_audit.mjs --budget` and `bun run build` (exit 0).

Mid-round corrections:
- **The stale-server lesson.** After the first `bun run build` + restart, the
  production server kept serving the previous build's CSS: Next 16 renames
  its server process to `next-server (v16.4.2)`, so a `pkill -f
  "standalone/server.js"` never matches it — the original process silently
  held port 3111 through two "rebuilds". Caught by diffing the served page's
  CSS chunk names against the fresh build's (referenced chunk did not exist
  in `.next/static/chunks`). Fixed by killing the pid directly and verifying
  the served chunk names after every restart. Recorded here so the next
  round does not re-verify against a ghost build.
- **The budget gates' measurement correction.** The first post-build audit
  measured 3,330 words (over the 3,320 gate) while the same build's e2e
  measured 3,297 — the difference was the session replay's autoplay: its
  visible transcript types in over ~9s (up to 111 words), so any
  "networkidle + fixed-settle" measure was timing-dependent, AND at finish
  the transcript counted TWICE (the animated screen plus its sr-only
  figcaption — `innerText` includes sr-only). Both gates
  (`scripts/landing_audit.mjs` + `e2e/landing-budget.spec.ts`) now measure
  the replay's FINISHED state and subtract the sr-only a11y lanes (246
  annotation words on this page: the transcript, the dex's "entry N of 22"
  tails, the copy buttons' status regions). The gates are deterministic,
  agree with each other, and the budget number is UNCHANGED — the
  deterministic readable count is 3,153, comfortably inside 3,320, with the
  0.0.37 stop's ~30 generated words already accounted for. The old green
  numbers were riding on mid-replay measurement, not on a smaller page.

## Checkpoint 3 — verification against a production build (DONE)

- Playwright e2e: **15/15** — axe-core A/AA zero violations in BOTH motion
  states, the scroll budget at the corrected deterministic measure
  (13.3vh / 3,153w), the dex video decode + mp4 fallback, the whole SEO
  surface (the finale lead's word-splitting keeps the sentence's textContent
  exact, like the h1 before it).
- `landing_shots.mjs`: 20 sections + 3 reduced-motion stills, both schemes,
  zero console errors.
- `contrast_audit.mjs`: 1,812 visible text nodes across both schemes, zero
  AA failures — the decode fill measures AA at every frame by construction
  (it animates between two AA palette text tokens, never an opacity).
- `theme_toggle_check.mjs`: cycle + persistence + label PASS.
- Real-user browser pass (`node` + Playwright driving the production build
  like a visitor, clip + stills recorded): **16/16 expectations** — the
  decode panel's glyph draws itself when the alphabet band first enters view
  (the dash ladder caught mid-flight, `pathLength=1`), re-carves on every
  tile hover (dashoffset back to ~1) and resolves (dashoffset → 0, ladder
  removed at rest); the spellbox letters carve as typed (typed HELLO,
  mid-carve dashoffsets observed on 7 of 8 paths, then resolved); the finale
  lead holds the faint `from` state below the viewport (rgb(156,180,222))
  and settles at the dim `to` state when read through (rgb(189,205,230));
  the per-word stagger caps at `--wf=8`; the keycap chips render in both
  homes (Geist Mono face, 3px keycap depth); the copy button announces
  "Copied" politely for the 2s window and goes silent after, with the
  accessible name swapping in step.
- Agnes VLM design critique (apihub endpoint, the repo's `review:vlm` lane)
  over the round's four surfaces, then a re-review of the chip after the
  fix. Shipped findings: **one** — the first cut's keycap chip grew its host
  line (21.5px in a 16.5px line box) and overhung the text baseline by
  6.5px; compacted to BetaBadge-proportioned keycap metrics (18.3px, 1px
  below baseline — keycap depth, the MDN/GitHub idiom) and re-reviewed:
  VERDICT PASS. The remaining findings were pre-existing documented
  decisions or recommendations the page's own record rejects (scanlines —
  the TFT-panel rule; blinking text — the no-autonomous-motion rule; the
  O-form's eye — authentic anatomy; the dim lead — the page-wide lead
  convention, contrast-audited AA at 8.55:1; "HELLO" under-lit — the leaf
  field's audited palette), left to their owning contracts and recorded in
  the research doc.
- Entrance media captured for the blog: the decode panel mid-carve and
  carved, the spellbox carving HELLO, the finale lead filled, the keycap
  chips in both homes, and a choreography clip (`download/carving-round/`).
- Harness notes for the next round, recorded because they cost real time:
  Playwright's trusted-pointer click stalls headless Chromium's clipboard
  IPC (a JS-dispatched click drives the same real handler end to end); the
  production server's process title hides from `pkill` (see checkpoint 2);
  rAF wall-clock under video recording is jittery — poll for resolved
  states instead of fixed waits.

## Checkpoint 4 — docs, blog, DOX (DONE)

- `src/components/landing/AGENTS.md` carries the round's wiring contracts:
  the DrawGlyph/driver ownership (finished-first, IO-armed, replay-on-id,
  decorative), the `.ink-fill` color-token rule + the stagger cap, the
  `.gb-kbd` mono-face rule, the CopyButton status region — plus the carving
  suite in Verification and the scroll-budget bullet's measurement note.
- `docs/AGENTS.md` ownership lists the carving pair;
  `docs/landing-research.md` gained the dated section "2026-10-28 — the
  carving round" (the TOC links it); the README links both new docs in the
  Documentation table and names the round (with the deterministic budget
  numbers) in the Landing page section.
- Blog post `content/blog/2026-10-28-the-carving-round.md` (type feature)
  with the choreography clip (webm + faststart mp4) and six stills under
  `public/blog/2026-10-28-the-carving-round/`, all shot against the shipped
  build; `landing_blog.mjs` regenerated (19 posts) and `check:blog` green.
- The tracked OG shots (`public/landing/landing-{hero,full,mobile}.png`)
  regenerated against the release build — the standing same-change rule
  (the balanced headings rewrapped two of the three).
- CHANGELOG `[0.0.37] - 2026-10-28` written; `package.json` → 0.0.37
  (JSON-LD `softwareVersion` reads it — verified in the build);
  `landing_changelog.mjs` regenerated (35 stops, 35 dated).
- Budget with the new stop: audit 13.3vh / 3,170w against 13.5 / 3,320 —
  inside the gate with NO amendment, as the measurement fix calculated
  (the stop's generated chrome lands inside the ~170 words of headroom the
  deterministic count opened).
- Release build re-verified end to end: 554 unit tests green (the parley
  round's domain-layer suite, landed concurrently, rides along), e2e
  15/15, contrast 1,822 nodes clean in both schemes.
- Concurrent-session note (the presence/SOTA precedent again): the parley
  round is mid-flight on main building its SaaS demo and its records
  describe "v0.0.37's build". This round cut first, so the carving round is
  0.0.37 and the parley round's work rides this tag UNDATED (its CHANGELOG
  entry will date when it cuts its own release — the rail renders cut
  stops only). Its session record will need the same renumbering note the
  SOTA round's got.

## Checkpoint 5 — release v0.0.37 (DONE — SHIPPED)

- Bun at 1.4.4; `bun run agent:install` (link/service steps skipped) built
  the vendored pi workspace end to end; `bun bin/unown --version` → 0.0.37
  (matches package.json — the release contract).
- `release:artifacts --dry-run` printed exactly the six-target plan;
  `release:artifacts` compiled ALL SIX per-OS binaries locally
  (42.2–55.3 MiB) into `download/artifacts/`;
  `release-manifest.ts --out` wrote the unsigned release.json for 0.0.37
  (6 platform assets, installers staged) and `--check --require-all`
  verified the payload.
- **The pre-tag xplat catch:** `node scripts/xplat.mjs local --scenario full`
  went red on the engine integration suite — NOT this round's code: the
  concurrent task-mint work seeded a sixth benchmark task
  (`swap-if-else-messages`) and the older integration pins still said five
  (`GET /api/tasks`, `kpis.tasks`, `kpis.suite.total`). Their unit suite
  already pins six, so the fix direction was unambiguous — the stale pins
  were updated to six and the suite re-verified (13/13), committed as its
  own xplat fix (the release workflow runs this suite on the tag, so main
  must be green before any cut).
- `node scripts/xplat.mjs dispatch --scenario release-verify` → run
  40737718284 **completed success**: the release path minus publish — six
  binaries built and BOOTED on six runners (incl. windows-11-arm).
- Tag `v0.0.37` pushed; `.github/workflows/release.yml` (run 40740455942)
  **completed success end to end**: the 3-OS verify matrix (real
  installer, engine unit + integration suites, bridge, version
  consistency, CLI smokes, the artifact plan gate), the production build +
  six per-OS binaries + SBOM + attestations, five per-platform artifact
  smokes (each platform ran its own archive), the GitHub Release created
  and PROMOTED (not a draft) with all **13 assets** (the six binaries,
  install.sh + install.ps1, release.json, version.txt, sha256sums.txt,
  sbom-spdx.json, release-checklist.md — verified via the API), the
  published feed re-downloaded and hash-verified, and the three-OS
  smoke-install matrix green (installs the released binary through the
  release's own installer, checks --version, update --check,
  uninstall --dry-run).
- `bun scripts/verify-deploy.mjs` against the live deployment: **all
  checks passed** — and the round's own markers are live: `.ink-fill` and
  `.gb-kbd` in the shipped HTML, the 0.0.37 rail stop, `softwareVersion`
  0.0.37 in the JSON-LD, the `psst` konami hint, and the empty-at-rest
  "Copied" status region (zero occurrences in raw HTML is the WCAG 4.1.3
  contract — the word appears only on click). The feed carries the round's
  blog post.
- The concurrent parley round's newest commits landed on main while this
  release was being cut; the tag points at the verified commit and the
  release builds from the tag, so their in-flight work rides the NEXT
  release (their changelog entry dates when they cut, per the rail's
  cut-stops-only rule).
