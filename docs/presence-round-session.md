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

## Checkpoint 2 — implementation (IN PROGRESS)

Planned file map (one effect per concern, effects live in `effects.tsx`,
styles in `landing.css`, wiring in the owning band):

| Change | File(s) |
|---|---|
| `DecodeText` (H1 wave) | `src/components/landing/effects.tsx` + `hero.tsx` |
| `.route-bar` progress | `src/app/landing.css` + `page.tsx` |
| `useScrollSpy` + `aria-current` | `effects.tsx` + `shell.tsx` (Nav) |
| `useSpotlight` + `[data-spotlight]` | `effects.tsx` + `landing.css` + proof/dex/live-demo cards |
| `.gb-btn` glint | `landing.css` |
| Live chip | `live-demo.tsx` |
| `CountUp` | `effects.tsx` + `benchmarks.tsx` |
| `.pane-swap` fade | `landing.css` + `proof.tsx` + `dex.tsx` |
| unit tests | `src/components/landing/__tests__/presence.test.tsx` |

Gates to run before any push: `bun run lint`, `bun run typecheck`,
`bun test src`, `bun run test:coverage`, `check:changelog|blog|benchmarks|claims`,
`gba_palette_check.mjs`, `landing_audit.mjs --budget`.

## Checkpoint 3 — verification against a production build (PENDING)

`bun run build`, `landing_shots.mjs` (both schemes + reduced motion + mobile),
`contrast_audit.mjs`, `theme_toggle_check.mjs`, `audit:landing --budget`,
Playwright e2e (a11y both motion states, budget, dex video, SEO), and a VLM
design critique through the Agnes lane (`scripts/agnes_review.mjs` pointed at
the apihub endpoint — the repo's own reviewer's aid).

## Checkpoint 4 — docs, blog, DOX (PENDING)

`docs/landing-research.md` gains the round's part; the landing AGENTS.md gains
the effects contracts; this file and the research doc link into the DOX tree;
blog post `content/blog/2026-10-28-the-presence-round.md` with captured media;
README checked for staleness; OG shots regenerated (visual change ⇒ the
tracked `public/landing/*.png` set moves in the same change).

## Checkpoint 5 — release v0.0.36 (PENDING)

CHANGELOG `[0.0.36]` entry, `package.json` bump, budget amendment if the new
changelog stop pushes the word count (compress first, amend with rationale
second — never delete a generated number), `release:artifacts` dry-run + real
run locally to prove the builds compile, push `main`, tag `v0.0.36`, watch the
release workflow promote the draft, confirm the release assets and the live
deploy gate.
