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

## Checkpoint 2 — implementation (PENDING)

Planned file map (one effect per concern; effects in `effects.tsx`, styles in
`landing.css`, wiring in the owning band):

| Change | File(s) |
|---|---|
| `useGlyphReveal` + `DrawGlyph` (pure `glyphRevealAt` exported) | `src/components/landing/effects.tsx` |
| decode-panel glyph → `DrawGlyph` | `src/components/landing/alphabet.tsx` |
| spellbox glyphs → `DrawGlyph` | `src/components/landing/finale.tsx` |
| `.ink-fill` decode fill + `SectionHead`'s `decode` prop | `src/app/landing.css` + `src/components/landing/shell.tsx` |
| `.gb-kbd` keycap chips (hint + receipt lines) | `src/app/landing.css` + `alphabet.tsx` + `finale.tsx` |
| "Copied" `role="status"` region | `src/components/landing/shell.tsx` (`CopyButton`) |
| `text-balance` on the section H2 | `src/components/landing/shell.tsx` (`SectionHead`) |
| unit tests | `src/components/landing/__tests__/carving.test.tsx` |

Gates to hold green: `bun run typecheck`, `bun run lint`, `bun test src`,
`bun run test:coverage` (changed-line 80% floor), `check:changelog|blog|
benchmarks|claims`, `gba_palette_check.mjs`, `landing_audit.mjs --budget`
(13.5vh / 3,320 words — the 0.0.37 stop's ~30 generated words land when the
release is cut; re-measure then, compress or amend per the standing rules),
`bun run build`.

## Checkpoint 3 — verification against a production build (PENDING)

- `bunx playwright test` (axe both motion states, the scroll budget, the dex
  video decode + mp4 fallback, the SEO surface).
- Against a production build: `landing_shots.mjs` (both schemes + reduced
  motion), `contrast_audit.mjs` (every visible text node, both schemes — the
  decode fill must measure AA mid-animation by construction),
  `theme_toggle_check.mjs`, `bun run audit:landing --budget`.
- Real-user browser pass: the decode panel's glyph drawing on first view and
  re-carving on tile hover/pick; the spellbox letters carving as typed; the
  finale lead resolving word-by-word; the keycap chips; the "Copied"
  announcement visible in the accessibility tree.
- Agnes VLM design critique (`bun run review:vlm`, the apihub lane) over the
  round's surfaces; ship the actionable findings, record the pre-existing
  ones as their owning contracts' decisions.
- Entrance media for the blog post (stills + a short clip of the carve, the
  spell and the fill), staged under `public/blog/2026-10-28-the-carving-round/`.

## Checkpoint 4 — docs, blog, DOX (PENDING)

- `src/components/landing/AGENTS.md`: the round's wiring contracts + the
  carving suite in Verification.
- `docs/AGENTS.md` ownership + README Documentation table: the two new docs.
- Blog post `content/blog/2026-10-28-the-carving-round.md` (type feature) with
  media; `landing_blog.mjs` regenerated; `check:blog` green.
- The tracked OG shots regenerated against the production build (the standing
  same-change rule, since the finale band's resting pixels change with the
  balanced headings only if they rewrap — shoot and diff to decide).
- CHANGELOG `[0.0.37] - 2026-10-28` written; `package.json` → 0.0.37;
  `landing_changelog.mjs` regenerated; the budget re-measured with the new
  stop, compressing or amending per the standing rules.

## Checkpoint 5 — release v0.0.37 (PENDING)

- `bun run agent:install` (link/service steps skipped) to build the vendored
  pi workspace; `release:artifacts --dry-run` must print exactly the
  six-target plan; `release:artifacts` compiles ALL SIX per-OS binaries;
  `release-manifest.ts --out download/artifacts` writes the unsigned
  release.json.
- Cross-platform lane per `docs/xplat-testing.md`: `full` before the tag,
  `release-verify` before tagging.
- Commit, push, tag `v0.0.37`, watch `.github/workflows/release.yml` to
  completion (3-OS verify matrix, six binaries + SBOM + attestations,
  per-platform smokes, the Release created and PROMOTED with its 13 assets,
  the feed gate, the three-OS smoke-install matrix).
- `bun scripts/verify-deploy.mjs` against the live deployment after the
  release: all checks passed.
