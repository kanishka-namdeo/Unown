/**
 * The "the third user product" band's data — Chaconne, the repo's third
 * self-contained user-facing app (`apps/chaconne/`), the Rondo round's
 * DRIVE-track vehicle (2026-11-06): a keyboard-first, self-hosted
 * browser-recipe runner PWA. Authored data (the ostinato-data pattern),
 * drift-pinned by `__tests__/chaconne.test.tsx`.
 *
 * The stills are the round's own capture lane's output:
 * `public/landing/chaconne/` (captured by
 * `apps/chaconne/scripts/capture-usage.mjs` through the real UI,
 * keyboard-only — zero pointer events; the lane's PROVENANCE.md sidecar
 * is its receipt). The capture lane stills seven honest states (five
 * light + two dark); the band carries the identity pair (the palette +
 * the artifact viewer), the other five ride the round's docs page.
 * 2560×1600 IHDR (1280×800 viewport @ deviceScaleFactor 2, full-page).
 *
 * No numbers on this band by decision: the Rondo round's battery lanes
 * (the 20-spec e2e, Lane A/B) are C-11's CI gate + runbook, not
 * committed receipts, so there is nothing receipted to print yet.
 * Everything the band says that is not the lede is a receipted link out.
 */

export interface ChaconneStill {
  src: string;
  /** The real IHDR dims (the dex-media gate's rule). */
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const CHACONNE_STILLS: ChaconneStill[] = [
  {
    src: "/landing/chaconne/05-palette-light.png",
    width: 2560,
    height: 1600,
    alt: "Chaconne with the command palette open — every recipe, run and data command enumerated with keyboard hints",
    caption: "The command palette — every action, one keystroke apart",
  },
  {
    src: "/landing/chaconne/04-artifact-viewer-light.png",
    width: 2560,
    height: 1600,
    alt: "The artifact viewer: a run's screenshot panel and extracted-values table",
    caption: "The artifact viewer — the run's evidence, content-addressed",
  },
];

/** The two exit links — the receipt lanes, committed artifacts. */
export const CHACONNE_LINKS: { label: string; href: string }[] = [
  {
    label: "the docs",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/chaconne.md",
  },
  {
    label: "the PRD",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/chaconne-prd.md",
  },
];

/**
 * The band's lede (the product-tile claim, honest and short — the scroll
 * budget makes the band pay for its own height, so this stays minimal).
 * The honest-scope clause is the PRD's own wording (Chromium-desktop-only,
 * fixture-verified, self-hosted).
 */
export const CHACONNE_LEDE =
  "The repo's third user-facing app: a keyboard-first, self-hosted browser-recipe runner PWA. Compose a flow — goto, click, fill, assert, extract, screenshot — and it repeats on a schedule, capturing a content-addressed artifact and an honest run record every time. Fixture-verified by construction: every test lane runs against local fixture pages, never the live network. Honest scope: Chromium-desktop-only.";
