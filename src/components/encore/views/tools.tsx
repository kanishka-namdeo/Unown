"use client";

import * as React from "react";
import { DISCRIMINATION, TOOL_CARDS } from "@/lib/encore/seed";
import { score } from "@/lib/encore/format";
import type { ToolCard } from "@/lib/encore/types";
import { AxisBar, ProvenanceLine, ReceiptRef } from "../primitives";

/**
 * Band 5 — The Tools (plan §5.5).
 *
 * Two tool cards in a 2-up grid (drops to 1-up at 390px):
 *  1. `design_critic.mjs` — its receipt: the baseline + the calibration.
 *     The headline number (6.40 baseline, verdict FAIL) and the
 *     receipt link are from the seed.
 *  2. `calibration-fixture` — the 1.5-vs-6.4 discrimination story
 *     as accessible AxisBars (two bars from `DISCRIMINATION`).
 *     The bars carry `role="img"` + `aria-label`; the figure
 *     caption says the separation in words.
 *
 * All numbers come from the seed constants — no hard-coded values.
 * The chart on the calibration card uses `DISCRIMINATION.calibBad`
 * and `DISCRIMINATION.baseline` as the two bar values.
 *
 * A11y (plan §5.5):
 *  - Each card is an `article` with an `aria-label`
 *  - The chart is a `figure` + `figcaption` (the separation, text)
 *  - Bars carry `role="img"` + `aria-label`
 *
 * Iter0 critique fixes: the two cards' inner blocks are
 * structure-identical (the receipt block sits at the same y in both
 * — the alignment defect, work order 6, enforced by matching the
 * internal structure + `items-stretch`); the tool name stays mono
 * (it IS a filename, so mono is correct) but reads in INK, not
 * gold-on-gold-competing (work order 5: the header no longer
 * fights the section title); receipt lines are the short-ref
 * pattern with the full path in `title`; the "headline" label is
 * an eyebrow that reads on panel-2; the receipt footnote is DIM
 * (the mobile illegibility defect — was Faint at /70).
 */

export function Tools({ embed }: { embed: boolean }) {
  void embed;
  const criticCard = TOOL_CARDS[0];  // design-critic
  const calibCard = TOOL_CARDS[1];   // calibration-fixture

  return (
    <section
      id="tools"
      className="encore-section"
      aria-labelledby="tools-heading"
    >
      <div className="mx-auto w-full max-w-3xl">
        <ToolsHeading />

        {/* 2-up card grid — drops to 1-up at 390px. Both cards
            stretch to the taller one (the receipt blocks align);
            the receipt block is the LAST inner block in both
            (matching internal structure — the y-alignment fix). */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-stretch">
          {/* Card 1: the design critic */}
          <article
            aria-label={`Tool: ${criticCard.name}`}
            className="encore-reveal flex flex-col border border-line bg-panel p-6"
            data-testid="tools-critic-card"
          >
            <ToolCardHeading card={criticCard} />
            <p className="encore-type-body-sm mt-4 text-dim">{criticCard.role}</p>

            {/* The headline number (from the seed — the baseline's overall) */}
            <div className="mt-4 border border-line bg-panel-2 p-4">
              <span className="encore-type-eyebrow mb-2 block text-gold">headline</span>
              <span className="encore-type-body-lg font-semibold text-gold">
                {criticCard.headline}
              </span>
            </div>

            {/* The receipt ref — the short-ref pattern: full path in
                `title`, SANS, dim; identical block to card 2's
                receipt block (the y-alignment contract). */}
            <p className="encore-type-caption mt-4 text-dim">
              <ReceiptRef path={criticCard.receipt} short={`receipt · ${criticCard.id}`} />
            </p>
          </article>

          {/* Card 2: the calibration fixture — the 1.5-vs-6.4
              discrimination story as accessible AxisBars */}
          <article
            aria-label={`Tool: ${calibCard.name} — the 1.5-vs-6.4 discrimination story`}
            className="encore-reveal flex flex-col border border-line bg-panel p-6"
            data-testid="tools-calibration-card"
          >
            <ToolCardHeading card={calibCard} />
            <p className="encore-type-body-sm mt-4 text-dim">{calibCard.role}</p>

            {/* The discrimination chart: two AxisBars side by side.
                BEFORE = calibBad overall (1.50), AFTER = baseline overall
                (6.40). The 4.9-pt separation is labelled in the
                figcaption (plan §5.5). The chart box mirrors card 1's
                headline box (same border + fill + padding) so the
                blocks align across the two cards. */}
            <figure
              className="mt-4 flex flex-col border border-line bg-panel-2 p-4"
              data-testid="tools-discrimation-chart"
            >
              <figcaption className="encore-type-caption mb-4 text-dim">
                The critic scores the known-bad fixture{" "}
                <strong className="text-poke">{score(DISCRIMINATION.calibBad)}</strong>{" "}
                vs the real page{" "}
                <strong className="text-gold">{score(DISCRIMINATION.baseline)}</strong>{" "}
                — a{" "}
                <strong className="text-gold">{DISCRIMINATION.separation}-pt</strong>{" "}
                separation proves it discriminates, it does not
                rubber-stamp.
              </figcaption>
              <div className="flex flex-col gap-2">
                {/* The known-bad fixture bar */}
                <AxisBar
                  axis="overall"
                  value={DISCRIMINATION.calibBad}
                  floor={7}
                  label="Known-bad fixture"
                />
                {/* The baseline bar */}
                <AxisBar
                  axis="overall"
                  value={DISCRIMINATION.baseline}
                  floor={7}
                  label="Real baseline"
                />
              </div>
            </figure>

            {/* The receipt ref — the same short-ref block as card 1,
                at the same y (the alignment contract). */}
            <p className="encore-type-caption mt-4 text-dim">
              <ReceiptRef path={calibCard.receipt} short={`receipt · ${calibCard.id}`} />
            </p>
          </article>
        </div>

        {/* The band's ONE provenance line (work order 3) — the
            calibration receipt; the critic card's receipt is the
            same round's README, carried in its own `title`. */}
        <div className="mt-4">
          <ProvenanceLine path={calibCard.receipt} />
        </div>      </div>
    </section>
  );
}

/* ── sub-components ───────────────────────────────────────────────── */

function ToolsHeading() {
  return (
    <header className="mb-8">
      <p className="encore-type-eyebrow encore-face-accent text-gold">
        The Tools
      </p>
      <h2
        id="tools-heading"
        className="encore-type-display-4 mt-4 font-semibold text-ink"
      >
        Two tools, built this round
      </h2>
      <p className="encore-type-body-lg mt-4 max-w-xl text-dim">
        The design critic and its calibration fixture — the two
        instruments that make the loop&apos;s numbers real.
      </p>
    </header>
  );
}

/**
 * The tool card header: the tool name in mono — the name is a
 * FILENAME, so mono is the correct register (work order 5 keeps
 * mono for code), now in INK so it does not compete with the
 * section title's gold (iter0 band04: "too dominant and bright").
 */
function ToolCardHeading({ card }: { card: ToolCard }) {
  return (
    <div className="mb-2">
      <h3 className="encore-type-body font-semibold text-ink">
        <code className="font-mono">{card.name}</code>
      </h3>
    </div>
  );
}
