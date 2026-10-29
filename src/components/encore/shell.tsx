"use client";

import * as React from "react";
import { ENCORE_ITERATIONS } from "@/lib/encore/seed";
import { ReceiptRef } from "./primitives";
import { Hero } from "./views/hero";
import { Baseline } from "./views/baseline";
import { Loop } from "./views/loop";
import { Iterations } from "./views/iterations";
import { Tools } from "./views/tools";
import { Failures } from "./views/failures";
import { Finale } from "./views/finale";

/**
 * EncoreShell — the /encore app frame (plan §4.5, Phase 3a+3b).
 *
 * Bands 1–7 of the eight-band showcase:
 *  1. Hero — the glyph-decode kicker, the page's single H1, the two
 *     CTAs, the live 7-axis strip animating the baseline means
 *  2. Baseline — the receipt card (every number from `BASELINE_ITERATION`)
 *  3. The Loop — the keyboard-operable interactive stepper
 *  4. The Iterations — the BEFORE/AFTER drag comparison + delta table
 *  5. The Tools — the design critic + calibration fixture cards
 *  6. The Failures — the F-ledger (F10/F11, every failure a benchmark)
 *  7. The Finale — the program's success question + live answer + CTA
 *
 * `embed` is the `?embed=1` flag read server-side in
 * `src/app/encore/page.tsx` and passed down as a PROP — the F3
 * hydration pin (plan §3.1): server render and hydration render
 * agree, React #418 never fires. When embedded, the band paddings
 * tighten (the `.embedded` scope class, in
 * `src/app/encore/globals.css`).
 *
 * The reset handshake (plan §3.4): the listener wipes the
 * client-side state — the loop stepper's selection, the slider
 * position, and the iteration pair (all three reset-wiped states)
 * to the initial state.
 */
export function EncoreShell({ embed }: { embed: boolean }) {
  // The stepper's active step — step 0 ("build") is the reset-wiped
  // default (plan §3.4). The reset listener below re-anchors it.
  const [activeStep, setActiveStep] = React.useState(0);
  // The slider position (0–100) — reset-wiped to 0 (plan §3.4).
  // The Iterations band owns the slider input; the shell owns the
  // state so the reset listener can wipe it in one place.
  const [sliderValue, setSliderValue] = React.useState(0);

  const baseline = ENCORE_ITERATIONS[0];
  const latest = ENCORE_ITERATIONS[ENCORE_ITERATIONS.length - 1];
  const overall = latest.overall.toFixed(2);

  /* ── the reset handshake (plan §3.4) ─────────────────────────────
   * The landing posts `{ source: "unown-landing", type:
   * "encore-reset" }` to `window.origin` (NEVER `*`). The listener
   * runs only in embed mode, checks origin + `source` + `type`,
   * then wipes to the initial state: the stepper re-anchors to
   * step 0.
   *
   * The happy-dom quirk (plan risk #7, pinned in §6.3):
   * `window.origin` is `null` under happy-dom, so a handler
   * comparing `e.origin !== window.origin` against a
   * `MessageEvent` with `origin: null` passes the origin check
   * unexpectedly — the shape check (`source` + `type`) keeps a
   * bare null-origin message out.
   */
  React.useEffect(() => {
    if (!embed) return;
    const onMessage = (e: MessageEvent) => {
      const expectedOrigin = window.origin; // null under happy-dom
      if (e.origin !== expectedOrigin) return;
      const data = e.data as
        | { source?: string; type?: string }
        | null
        | undefined;
      if (!data) return;
      if (data.source !== "unown-landing") return;
      if (data.type !== "encore-reset") return;
      // Wipe: the stepper re-anchors to step 0, the slider to 0
      // (the initial state — plan §3.4 documents exactly three
      // reset-wiped states: slider position, loop step, pair).
      setActiveStep(0);
      setSliderValue(0);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed]);

  return (
    <div className={embed ? "embedded min-h-full" : "min-h-full"}>
      <main className="encore-container flex flex-col">
        {/* ── band 1: the hero ───────────────────────────────────── */}
        <Hero overall={overall} embed={embed} />

        {/* ── band 2: the baseline receipt card ─────────────────── */}
        <Baseline iteration={baseline} embed={embed} />

        {/* ── band 3: the critique loop stepper ─────────────────── */}
        <Loop activeStep={activeStep} onSelect={setActiveStep} />

        {/* ── band 4: THE FLAGSHIP — BEFORE/AFTER + delta table ── */}
        <Iterations
          embed={embed}
          sliderValue={sliderValue}
          onSliderChange={setSliderValue}
        />

        {/* ── band 5: the tools (design critic + calibration) ──── */}
        <Tools embed={embed} />

        {/* ── band 6: the F-ledger ──────────────────────────────── */}
        <Failures embed={embed} />

        {/* ── band 7: the finale (question + answer + CTA) ─────── */}
        <Finale embed={embed} />

        {/* ── footer ────────────────────────────────────────────── */}
        <footer className="pb-8 text-center">
          <span className="encore-type-caption text-dim">
            Encore — the Website Excellence showcase · gallery app #8 ·{" "}
            {overall} overall ·{" "}
            <ReceiptRef path={baseline.receiptPath} short={`receipt · ${baseline.label}`} />
          </span>
        </footer>
      </main>
    </div>
  );
}
