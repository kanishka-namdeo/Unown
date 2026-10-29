"use client";

import * as React from "react";
import { Glyph } from "@/components/landing/glyph";
import { ENCORE_AXES } from "@/lib/encore/types";
import { axisLabel } from "@/lib/encore/format";
import { BASELINE_ITERATION } from "@/lib/encore/seed";
import { AxisBar, ReceiptRef } from "../primitives";

/**
 * Band 1 — the Hero (plan §5.1).
 *
 * The single H1 on the page: the showcase claim "Every great
 * performance earns an encore." — the word "encore" carries the
 * glyph-decode kicker (the Unown E glyph, decorative + `aria-hidden`;
 * the word is visible as text, so a screen reader gets the real
 * word, not the scramble).
 *
 * Sub: one sentence — what seven apps of practice taught the
 * platform, shown as one elite-grade web experience.
 *
 * Two CTAs: "See the loop" (anchor to `#loop`, the band-3 stepper) +
 * "Read the receipts" (anchor to `#baseline`, the band-2 receipt
 * card — every number on the page links to its `receiptPath`).
 *
 * The live axis-score strip: the seven VLM axis means from
 * `BASELINE_ITERATION`, rendered as `AxisBar`s inside a `figure` +
 * `figcaption` (plan §5.1 a11y contract). Under reduced motion the
 * strip renders the settled values immediately (the base-finished
 * card, not a blank frame — plan §4.4, pinned in
 * `reduced-motion.test.tsx` when it lands in 3b).
 *
 * Iter0 critique fixes: the sub-copy block is WIDENED (`max-w-2xl` →
 * the full `max-w-3xl` column) so the sentence no longer wraps to a
 * ragged three-line orphan; the secondary CTA gets a real affordance
 * (border-line-bright, panel-2 fill, bolder weight — it no longer
 * reads as passive text); the strip's footer receipt line is the
 * short-ref pattern (full path in `title`, SANS, no mono path).
 */
export function Hero({ overall, embed }: { overall: string; embed: boolean }) {
  const baseline = BASELINE_ITERATION;

  return (
    <section
      id="hero"
      className={`encore-section ${embed ? "" : "pt-0"}`}
      aria-labelledby="hero-heading"
    >
      <div className="mx-auto w-full max-w-3xl text-center">
        {/* The glyph-decode kicker: the Unown E, decorative, decoding
            to "ENCORE" in the accent face. `aria-hidden` — the word
            "encore" is visible as text in the H1 immediately below,
            so a screen reader gets the real word (plan §5.1).

            Iter1 work order 3 — the hierarchy fix: the kicker used
            to share near-identical visual weight with the headline
            (eyebrow 12px + accent face against a 48px display). It
            now drops to a clearly-subordinate kicker: the 12px caps
            tier (`encore-type-eyebrow`, the 0.08em tracking caps
            tier of the type ramp) with the glyph, no accent-face
            weight jump — the headline owns all the display weight. */}
        <div
          className="encore-type-eyebrow mb-8 flex items-center justify-center gap-4 text-gold"
          aria-hidden="true"
        >
          <Glyph
            id="E"
            weight="heavy"
            tone="lit"
            eye
            className="size-6 text-gold"
            label="E glyph"
          />
          <span>Encore</span>
        </div>

        {/* The page's single H1: the showcase claim.

            Iter1 work order 3 — the "encore." accent word loses its
            jarring weight/color jump: it stays the gold accent (the
            brand word) but reads as ONE line with the headline —
            same size tier, no weight jump, a slightly softer
            `gold-soft` tone so the accent harmonizes instead of
            shouting. */}
        <h1
          id="hero-heading"
          className="encore-type-display-3 font-semibold text-ink"
        >
          Every great performance earns an{" "}
          <span className="text-gold-soft">encore</span>.
        </h1>

        {/* Sub: one sentence. The block is the band's full width so
            the sentence wraps in two even lines, never a ragged
            three-line orphan (iter0 band00 defect). */}
        <p className="encore-type-body-lg mx-auto mt-8 text-dim">
          Seven apps of practice taught the platform to measure, receipt
          and ship. This is the proof — one elite-grade web experience,
          built end-to-end by the agent, every number sourced to a
          committed receipt.
        </p>

        {/* Two CTAs. */}
        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#loop"
            className="encore-type-body-sm border border-gold bg-gold px-6 py-3 font-medium text-canvas transition-colors hover:bg-gold-soft"
          >
            See the loop
          </a>
          <a
            href="#baseline"
            className="encore-type-body-sm border border-line-bright bg-panel-2 px-6 py-3 font-semibold text-ink transition-colors hover:border-gold"
          >
            Read the receipts
          </a>
        </div>

        {/* The live axis-score strip: the 7 baseline axis means,
            rendered as `AxisBar`s inside a `figure` + `figcaption`.
            Under reduced motion the strip renders the settled values
            immediately (the base-finished card, plan §4.4). */}
        <figure className="encore-reveal mx-auto mt-16 max-w-xl" data-testid="hero-strip">
          <figcaption className="encore-type-caption mb-4 text-center text-dim">
            Baseline axis means · overall {overall} of 10 · VLM floor 7.0
          </figcaption>
          <div
            className="flex flex-col gap-2 border border-line bg-panel px-6 py-6"
            role="group"
            aria-label="The seven VLM axis means from the baseline receipt"
          >
            {ENCORE_AXES.map((axis) => (
              <AxisBar
                key={axis}
                axis={axis}
                value={baseline.axes[axis]}
                floor={7}
                label={axisLabel(axis)}
              />
            ))}
          </div>
          {/* The receipt line: the short-ref pattern (iter0 work order
              1) — the full path lives in `title`, SANS, dim on the
              canvas, never mono, never wrapped over the edge. */}
          <figcaption className="encore-type-caption mt-4 text-center text-dim">
            <ReceiptRef path={baseline.receiptPath} />
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

