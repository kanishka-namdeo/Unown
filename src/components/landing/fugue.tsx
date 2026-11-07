"use client";

import { Fragment } from "react";
import {
  FUGUE_LEDE,
  FUGUE_LINKS,
  FUGUE_STILLS,
} from "./fugue-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * The "the fourth user product" band — Fugue, the repo's fourth
 * self-contained user-facing app (`apps/fugue/`), the Sonata round's
 * DRIVE-track vehicle (2026-11-07): a keyboard-first, offline-capable
 * PWA console for the engine's own automation + learning loop.
 *
 * Contract notes (the Chaconne band's shape, applied to the fourth
 * product — the "third user product" phrasing retires with this band):
 *  - A NEW band, not a gallery entry: every `LIVE_DEMO_APPS` row iframes a
 *    LANDING ROUTE; Fugue is a static PWA served by
 *    `apps/fugue/serve.mjs`, NOT a route in `src/app/`, so it cannot
 *    join the gallery's same-origin iframe + reset-handshake contract.
 *    The band says its own truth in its own words instead.
 *  - The stills are the round's own capture lane's real output
 *    (`public/landing/fugue/`, captured through the real UI by
 *    `apps/fugue/scripts/capture-usage.mjs` — keyboard-first over the
 *    fixture lane, zero pointer events on the palette commands),
 *    framed in the shared TerminalWindow chrome; declared dims are the
 *    PNGs' real IHDR (2560×1600), re-checked by
 *    `__tests__/fugue.test.tsx` against the files on disk.
 *  - STATIC by construction: the finished state is what SSR ships and
 *    what the budget gates measure — no autoplay, no typed content, no
 *    counters that only finish on view.
 *  - NO figure on this band by decision: the Sonata round's battery
 *    lanes are F-11's CI gate + runbook, not committed receipts yet —
 *    an un-receipted number would be an invention, and the honesty
 *    rules cut the claim rather than soften it. The band's claims exit
 *    as receipted links out (docs + receipts).
 *  - Drift-pinned by `__tests__/fugue.test.tsx`: the exact copy, the
 *    stills' paths/dims/alt/captions, and the no-number pin.
 */
export function FugueSection() {
  return (
    <section
      data-hue="gold"
      id="fugue"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The fourth user product">
            Fugue — the repo's fourth app that left the terminal
          </SectionHead>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            {FUGUE_LEDE}
          </p>
        </FadeUp>

        {/* The product tile: the identity pair of stills, framed in the shared chrome. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {FUGUE_STILLS.map((s) => (
              <TerminalWindow key={s.src} title={`fugue — ${s.caption}`}>
                <figure className="m-0">
                  <img
                    src={s.src}
                    alt={s.alt}
                    width={s.width}
                    height={s.height}
                    loading="lazy"
                    className="w-full"
                  />
                  <figcaption className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-faint">
                    {s.caption}
                  </figcaption>
                </figure>
              </TerminalWindow>
            ))}
          </div>

          {/* The receipt exits — absolute GitHub links into the docs and
              the round's receipts, not in-page routes. */}
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint">
            {FUGUE_LINKS.map((l, i) => (
              <Fragment key={l.href}>
                {i > 0 ? (
                  <span aria-hidden="true" className="px-0.5">
                    ·
                  </span>
                ) : null}
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 transition-colors hover:text-gold"
                >
                  {l.label}
                </a>
              </Fragment>
            ))}
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
