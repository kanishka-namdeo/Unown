/**
 * The "the fifth user product" band's data — Legato, the repo's fifth
 * self-contained user-facing app (`apps/legato/`), the Serenade round's
 * DRIVE-track vehicle (2026-11-07): a keyboard-first, offline-first
 * read-later / web-clip PWA. Authored data (the ostinato-data pattern),
 * drift-pinned by `__tests__/legato.test.tsx`.
 *
 * The stills are the round's own capture lane's output:
 * `public/landing/legato/` (captured by
 * `apps/legato/scripts/capture-usage.mjs` through the real UI,
 * keyboard-first — the Ctrl+K palette over the clip/tag lanes; the
 * lane's PROVENANCE.md sidecar is its receipt). The capture lane stills
 * six honest states (light scheme — the band's identity set); the band
 * carries the identity pair (the reading inbox + the hostile-clip
 * honesty), the other four ride the round's docs page.
 * 2560×1600 IHDR (1280×800 viewport @ deviceScaleFactor 2, viewport-clipped).
 *
 * No numbers on this band by decision: the Serenade round's battery
 * lanes (the 14-spec e2e, the B-16 holdout) are L-13's CI gate + runbook,
 * not committed receipts yet — an un-receipted number would be an
 * invention, and the honesty rules cut the claim rather than soften it.
 * The band's claims exit as receipted links out (docs + receipts).
 */

export interface LegatoStill {
  src: string;
  /** The real IHDR dims (the dex-media gate's rule). */
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const LEGATO_STILLS: LegatoStill[] = [
  {
    src: "/landing/legato/02-list-light.png",
    width: 2560,
    height: 1600,
    alt: "Legato's clip list with real clips seeded through the app's own keyboard clip flow — the clean story, the redirect chain, and the paywall excerpt, each row with its extracted title and state badge",
    caption: "The reading inbox — real clips, clipped through the app's own keyboard flow",
  },
  {
    src: "/landing/legato/06-hostile-light.png",
    width: 2560,
    height: 1600,
    alt: "Legato's hostile-clip outcomes — two degraded rows from the app's own clip flow against a walled and a wrong-charset fixture, each with its honest taxonomy badge",
    caption: "The hostile-clip honesty — every taxonomy lane degrades, never silently",
  },
];

/** The exit links — the receipt lanes, committed artifacts. */
export const LEGATO_LINKS: { label: string; href: string }[] = [
  {
    label: "the docs",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/legato.md",
  },
  {
    label: "the round receipts",
    href: "https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/serenade-round/receipts",
  },
];

/**
 * The band's lede (the product-tile claim, honest and short — the scroll
 * budget makes the band pay for its own height, so this stays minimal).
 * The honest-scope clause is the PRD's own wording (Chromium-desktop-only,
 * fixture-verified, offline-first, no account, no server).
 */
export const LEGATO_LEDE =
  "The repo's fifth user-facing app: a keyboard-first, offline-first read-later PWA — clip any URL, get a clean readable copy stored locally, find it again with full-text search + tags, read in a keyboard-driven queue, highlight what mattered, carry everything in a byte-stable JSON bundle. Fixture-verified: every test lane runs against the hostile fixture server, never the live network; the js-walled fallback is an honest title+URL+flag, never a bypass. Honest scope: Chromium-desktop only.";
