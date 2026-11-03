/**
 * The "the first user product" band's data — Coda, the repo's first
 * self-contained user-facing app (`apps/coda/`), the Coda round's artifact
 * (2026-11-02) and the doc-truth round's T3 capture. Authored data (the
 * built-improved-data pattern), drift-pinned by `__tests__/coda.test.tsx`.
 *
 * The stills are the T3 capture lane's output: `public/landing/coda/`
 * (captured by `apps/coda/scripts/capture-usage.mjs` through the real UI;
 * the lane's PROVENANCE.md sidecar is its receipt). 2560×1600 IHDR
 * (1280×800 viewport @ deviceScaleFactor 2, full-page).
 *
 * The only figure the band may cite (its T2 receipt): offline
 * boot-from-cache 91 ms median vs online 175 ms median, N=5 —
 * `benchmarks/coda-pwa/RESULTS.md`, caveats verbatim (headless chromium,
 * dev-server transpile; the DELTA is the signal). No other numbers:
 * everything else the band says is a receipted link out, not a claim
 * on the page.
 */

export interface CodaStill {
  src: string;
  /** The real IHDR dims (the dex-media gate's rule). */
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const CODA_STILLS: CodaStill[] = [
  {
    src: "/landing/coda/01-fresh-boot.png",
    width: 2560,
    height: 1600,
    alt: "Coda — the app at its real ready marker on a fresh context: the seeded notes list and task board, no user data",
    caption: "Fresh boot — the app at \"Ready.\"",
  },
  {
    src: "/landing/coda/02-in-use.png",
    width: 2560,
    height: 1600,
    alt: "Coda in use — the same app after the e2e spec's own interactions: a saved note and a task created through the real UI",
    caption: "In use — the e2e spec's own interactions, the real DOM",
  },
];

/** The two exit links — the receipt lanes, committed artifacts. */
export const CODA_LINKS: { label: string; href: string }[] = [
  {
    label: "the docs",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/coda.md",
  },
  {
    label: "the PWA benchmark lane",
    href: "https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/coda-pwa",
  },
];

/**
 * The one figure the band carries (the T2 receipt) — printed with its
 * caveats, never a bare "fast" claim: the DELTA is the signal, the
 * absolute ms are the environment's (the receipt's own wording).
 */
/**
 * The stills' captions ride the figcations; this is the band's only
 * receipted figure. Printed with its caveats so the DELTA is the signal,
 * the absolute ms the environment's (the T2 receipt's own wording).
 */
export const CODA_OFFLINE_FIGURE =
  "offline boot-from-cache 91 ms vs online 175 ms (N=5) — the 84 ms delta is the precache's measured effect; the ms are the environment's";

/** The band's lede (the product-tile claim, honest and short — the scroll
 *  budget makes the band pay for its own height, so this stays minimal). */
export const CODA_LEDE =
  "The repo's first user-facing app: local-first markdown notes and task boards, offline-first, installable, all data in the browser. Verified by its own isolated e2e lane — honestly scoped: Chromium-desktop-only, not cross-platform.";
