/**
 * The "the second user product" band's data — Ostinato, the repo's second
 * self-contained user-facing app (`apps/ostinato/`), the Ostinato round's
 * artifact (2026-11-04): a keyboard-first, offline-first spaced-repetition
 * flashcard PWA. Authored data (the coda-data pattern), drift-pinned by
 * `__tests__/ostinato.test.tsx`.
 *
 * The stills are the round's own capture lane's output: `public/landing/ostinato/`
 * (captured by `apps/ostinato/scripts/capture-usage.mjs` through the real UI,
 * keyboard-only; the lane's PROVENANCE.md sidecar is its receipt). The
 * capture lane stills four honest states; the band carries the identity
 * pair (the palette + the revealed markdown back), the other two ride the
 * round's blog post. 2560×1600 IHDR (1280×800 viewport @ deviceScaleFactor
 * 2, full-page).
 *
 * The only figure the band may cite (its receipt run
 * `benchmarks/ostinato/receipts/run-20261104T181704Z/` — the committed
 * re-run on a fresh clone): the hardening battery, 12 specs across five
 * lanes, 12/12, 8.5 s first run / 7.2 s re-run, headless chromium-1248,
 * the external Playwright verifier — no self-grading. No other numbers:
 * everything else the band says is a receipted link out, not a claim on
 * the page.
 */

export interface OstinatoStill {
  src: string;
  /** The real IHDR dims (the dex-media gate's rule). */
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const OSTINATO_STILLS: OstinatoStill[] = [
  {
    src: "/landing/ostinato/02-palette.png",
    width: 2560,
    height: 1600,
    alt: "Ostinato with the command palette open — every workflow reachable by keyboard",
    caption: "The command palette — keyboard-first",
  },
  {
    src: "/landing/ostinato/04-revealed.png",
    width: 2560,
    height: 1600,
    alt: "The card's back face revealed, with markdown rendered",
    caption: "The reveal — markdown on the back face",
  },
];

/** The two exit links — the receipt lanes, committed artifacts. */
export const OSTINATO_LINKS: { label: string; href: string }[] = [
  {
    label: "the docs",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/ostinato.md",
  },
  {
    label: "the benchmark lane",
    href: "https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/ostinato",
  },
];

/**
 * The one figure the band carries (the O-4/O-5 hardening battery, receipt
 * `run-20261104T181704Z`) — printed with its caveats, never a bare "tested"
 * claim: the external verifier is the point, the timing is the
 * environment's.
 */
export const OSTINATO_BATTERY_FIGURE =
  "the hardening battery: 12 specs across five lanes — 12/12, keyboard-only, axe-clean both schemes, offline, crash-resume — 8.5 s first run / 7.2 s re-run (headless chromium, the external Playwright verifier)";

/**
 * The band's lede (the product-tile claim, honest and short — the scroll
 * budget makes the band pay for its own height, so this stays minimal). */
export const OSTINATO_LEDE =
  "The repo's second user-facing app: a keyboard-first, offline-first spaced-repetition flashcard PWA. SM-2 scheduling, markdown decks, JSON import/export, crash-safe mid-review resume. Honest scope: Chromium-desktop-only.";
