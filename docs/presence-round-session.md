# The Presence Round — Session Record

The working log for the 2026-10-28 round that answers the brief *"what effects,
animations, elements can we include to make the landing page stunning and
intuitive for the end user?"* — and ships the answer. Kept as a resumable
record: each checkpoint states what is done, what is verified, and what is next,
so an interrupted session can resume from the last green state.

The research grounding for every decision is
[`docs/landing-effects-research.md`](landing-effects-research.md); the shipped
contracts live in
[`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md).

---

## Checkpoint 0 — setup (DONE)

- Cloned `kanishka-namdeo/Unown` at `f8afd26` (post-v0.0.35, the cadence
  round), `bun install` clean (400 packages).
- Dev server boots on :3000 (`bun run dev`); `/` answers 200.
- Read the full contract chain before touching anything: root `AGENTS.md`,
  `src/AGENTS.md`, `src/components/landing/AGENTS.md`, `scripts/AGENTS.md`,
  `docs/landing-research.md` (18 parts), `CHANGELOG.md`.
- Baseline screenshots captured (hero + full page, 1440×900) before any edit.
- Release lane understood: `git tag vX.Y.Z && git push origin vX.Y.Z` triggers
  `.github/workflows/release.yml`, which builds the six per-OS binaries, the
  manifest, the SBOM, asserts the plan, promotes a draft GitHub Release with
  the 13 assets, and runs the post-publish feed + smoke-install gates.

## Checkpoint 1 — research (DONE)

- Broad online research pass over the 2025–2026 dev-tool landing landscape
  (Linear, Vercel, Cursor, Supabase, Clerk, Resend, Warp, Raycast, Zed, Turso,
  Stripe, motion.dev; Magic UI / Aceternity pattern catalogs; NN/g motion
  research; web.dev performance guidance; the CSS scroll-driven-animations
  Baseline). Findings and citations: `docs/landing-effects-research.md`.
- The shortlist that survives this page's four motion invariants: H1 glyph
  decode wave, scroll route bar, nav scrollspy, card spotlight, CTA glint,
  demo Live chip, benchmarks count-up, pane-swap fades.
- Rejected with reasons: WebGL/canvas matrix, marquees, View Transitions,
  3D tilt, magnetic buttons, scrollytelling, back-to-top.

## Checkpoint 2 — implementation (DONE)

Planned file map (one effect per concern, effects live in `effects.tsx`,
styles in `landing.css`, wiring in the owning band):

| Change | File(s) |
|---|---|
| `DecodeText` (kicker wave) | `src/components/landing/effects.tsx` + `hero.tsx` |
| `.route-bar` progress | `src/app/landing.css` + `page.tsx` |
| `useScrollSpy` + `aria-current` | `effects.tsx` + `shell.tsx` (Nav) |
| `SpotlightProvider` + `[data-spotlight]` | `effects.tsx` + `landing.css` + proof/dex cards |
| `.gb-btn` glint | `landing.css` |
| Live chip | `live-demo.tsx` |
| `CountUp` | `effects.tsx` + `benchmarks.tsx` |
| `.pane-swap` fade | `landing.css` + `proof.tsx` + `dex.tsx` |
| unit tests | `src/components/landing/__tests__/presence.test.tsx` |

Shipped as designed, plus two mid-round corrections:
- the decode's lock schedule went fractional (`floor(i*spread/span)`) — the
  first cut's minimum one-tick stagger made a 41-glyph line take 2.25s;
- the h1's inter-word spaces moved into the parent inline flow — a space
  inside an `inline-block` word span is collapsed by the browser's own
  whitespace rules, and a trailing one would drag into `textContent`.

Gates green at this checkpoint: `bun run typecheck`, `bun run lint`,
`bun test src` (359 pass), `bun run test:coverage` (91-100% on every touched
file), `check:changelog|blog|benchmarks|claims`, `gba_palette_check.mjs`
(21+21 tokens AA in both schemes), `landing_audit.mjs --budget` (13.3vh /
3,283w <= 13.5 / 3,320), `bun run build` (exit 0).

## Checkpoint 3 — verification against a production build (DONE)

- Playwright e2e: **15/15** — axe-core A/AA zero violations in BOTH motion
  states, the scroll budget (13.3vh / 3,275w), the dex video decode + mp4
  fallback, the whole SEO surface (the split-word h1 still reads as one
  keyword-bearing sentence to the crawler, the gate and `verify-deploy`).
- `landing_shots.mjs`: 20 sections + 3 reduced-motion stills, both schemes.
- `contrast_audit.mjs`: 1,737 visible text nodes, zero AA failures.
- `theme_toggle_check.mjs`: cycle + persistence + label all PASS.
- Real-user browser pass (Playwright-driven): the route bar scrubs
  (`matrix(0.577...)` mid-page), the scrollspy marks "How it learns" at the
  loop band and "Capability dex" one scroll later with the `▶` cursor lit,
  the spotlight vars land on the hovered card (`--mx: 552px`), the Live chip
  renders with its blinking square, and the decode wave was caught
  mid-flight — the VLM read the kicker as "ANOWN · WHILT ON PI", which is
  the UNOWN decoy alphabet doing exactly what it is designed to do.
- Agnes VLM design critique (apihub endpoint, the repo's `review:vlm` lane)
  over four shots: the actionable finding — the first cut's 2px route bar
  read "too subtle to read as a functional element" twice — shipped as the
  fix (3px, the page's border idiom). The remaining findings were
  pre-existing, documented design decisions (the hue walk, the density
  budget, the tab styling) and were left to their owning contracts.
- An entrance video (`download/effects/hero-entrance.webm`, 30fps) records
  the choreography: kicker decode -> word settle -> route bar -> scrollspy.
  (Scratch verification media — the blog's copy is staged separately.)

## Checkpoint 4 — docs, blog, DOX (DONE)

- `docs/landing-research.md` gained the dated section "2026-10-28 — the
  presence round"; the TOC links it.
- `src/components/landing/AGENTS.md` carries the round's wiring contracts
  (DecodeText/SpotlightProvider/useScrollSpy/CountUp ownership, the
  word-settle space rule, the route-bar/pane-swap/glint/Live-chip rules,
  the demo-frame no-spotlight rule) and the presence suite in Verification.
- `docs/AGENTS.md` ownership lists the two new docs; the README links both
  in the Documentation table and names the round in the Landing page
  section.
- Blog post `content/blog/2026-10-28-the-presence-round.md` (type feature)
  with the entrance video + three stills under
  `public/blog/2026-10-28-the-presence-round/`, shot against the shipped
  3px build; `landing_blog.mjs` regenerated (18 posts) and `check:blog`
  green.
- The tracked OG shots (`public/landing/landing-{hero,full,mobile}.png`)
  regenerated against the production build — the standing same-change rule.
- CHANGELOG `[0.0.36] - 2026-10-28` written; `package.json` → 0.0.36;
  `landing_changelog.mjs` regenerated (34 stops).
- Budget after the new stop: audit 3,308w / e2e 3,275w against 3,320 —
  inside the gate with no amendment, as calculated.

## Checkpoint 5 — release v0.0.36 (IN PROGRESS)

- Bun upgraded 1.3.14 → 1.4.4 (pi-repo's lockfileVersion 3 requires >= 1.4 —
  the fresh-clone installer enforces it).
- `bun run agent:install` (link/service steps skipped) built the vendored pi
  workspace end to end.
- `release:artifacts --dry-run`: exactly the six-target plan the workflow's
  plan gate asserts. `release:artifacts`: ALL SIX per-OS binaries compiled
  for 0.0.36 (42-55 MiB each) in `download/artifacts/`.
- `release-manifest.ts --out download/artifacts`: unsigned release.json for
  0.0.36, 6 platform assets, after staging the shipped installer scripts.
- Remaining: push, tag `v0.0.36`, watch `.github/workflows/release.yml`
  (install matrix, engine/bridge suites, SBOM + attestations, the six
  binaries, per-platform smoke runs, DRAFT release promotion, post-publish
  feed gate + smoke-install matrix), then confirm the live deployment gate.
