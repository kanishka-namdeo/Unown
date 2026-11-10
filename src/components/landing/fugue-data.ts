/**
 * The "the fourth user product" band's data — Fugue, the repo's fourth
 * self-contained user-facing app (`apps/fugue/`), the Sonata round's
 * DRIVE-track vehicle (2026-11-07): a keyboard-first, offline-capable
 * PWA console for the engine's own automation + learning loop. Authored
 * data (the ostinato-data pattern), drift-pinned by `__tests__/fugue.test.tsx`.
 *
 * The stills are the round's own capture lane's output:
 * `public/landing/fugue/` (captured by
 * `apps/fugue/scripts/capture-usage.mjs` through the real UI,
 * keyboard-first — the Ctrl+K palette over the learning routes; the
 * lane's PROVENANCE.md sidecar is its receipt). The capture lane stills
 * eight honest states (light scheme — the band's identity set); the
 * band carries the identity pair (the palette + the dreams journal),
 * the other six ride the round's docs page.
 * 2560×1600 IHDR (1280×800 viewport @ deviceScaleFactor 2, full-page).
 *
 * No numbers on this band by decision: the Sonata round's battery lanes
 * (the e2e battery, the fixture contract lane) are F-11's CI gate +
 * runbook, not committed receipts yet — an un-receipted number would be
 * an invention, and the honesty rules cut the claim rather than
 * soften it. The band's claims exit as receipted links out
 * (docs + receipts).
 */

export interface FugueStill {
  src: string;
  /** The real IHDR dims (the dex-media gate's rule). */
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const FUGUE_STILLS: FugueStill[] = [
  {
    src: "/landing/fugue/08-palette-light.png",
    width: 2560,
    height: 1600,
    alt: "Fugue with the command palette open — every job, run and learning command enumerated with keyboard hints",
    caption: "The command palette — every action, one keystroke apart",
  },
  {
    src: "/landing/fugue/04-dreams-light.png",
    width: 2560,
    height: 1600,
    alt: "The dreams journal: the AutoDream consolidation log with the five-status badge vocabulary and the expandable output preview",
    caption: "The dreams journal — the learning loop, as the product surface",
  },
];

/** The exit links — the receipt lanes, committed artifacts. */
export const FUGUE_LINKS: { label: string; href: string }[] = [
  {
    label: "the docs",
    href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/fugue.md",
  },
  {
    label: "the round receipts",
    href: "https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/sonata-round/receipts",
  },
];

/**
 * The band's lede (the product-tile claim, honest and short — the scroll
 * budget makes the band pay for its own height, so this stays minimal).
 * The honest-scope clause is the PRD's own wording (Chromium-desktop-only,
 * fixture-verified, self-hosted; the live lane is the off-peak proof lane,
 * not a capture lane).
 */
export const FUGUE_LEDE =
  "The repo's fourth user-facing app: a keyboard-first PWA console for the engine's own automation + learning loop — author, pause, resume, skip, snooze and run-now the scheduled agent jobs, watch runs back with honest status and tokens, curate the AutoDream journal, the memory tiers and the staged-skills queue. Fixture-verified: every test lane runs canned contract-pinned JSON, never the live network. Honest scope: Chromium-desktop only.";
