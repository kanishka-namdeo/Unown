"use client";

import { Fragment } from "react";
import {
  CHACONNE_LEDE,
  CHACONNE_LINKS,
  CHACONNE_STILLS,
} from "./chaconne-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * The "the third user product" band — Chaconne, the repo's third
 * self-contained user-facing app (`apps/chaconne/`), the Rondo round's
 * DRIVE-track vehicle (2026-11-06): a keyboard-first, self-hosted
 * browser-recipe runner PWA.
 *
 * Contract notes (the Ostinato band's shape, applied to the third
 * product — the "second user product" phrasing retires with this band):
 *  - A NEW band, not a gallery entry: every `LIVE_DEMO_APPS` row iframes a
 *    LANDING ROUTE; Chaconne is a static PWA served by
 *    `apps/chaconne/serve.mjs`, NOT a route in `src/app/`, so it cannot
 *    join the gallery's same-origin iframe + reset-handshake contract.
 *    The band says its own truth in its own words instead.
 *  - The stills are the round's own capture lane's real output
 *    (`public/landing/chaconne/`, captured keyboard-only through the real
 *    UI by `apps/chaconne/scripts/capture-usage.mjs` — zero pointer
 *    events, the K-1 law), framed in the shared TerminalWindow chrome;
 *    declared dims are the PNGs' real IHDR (2560×1600), re-checked by
 *    `__tests__/chaconne.test.tsx` against the files on disk.
 *  - STATIC by construction: the finished state is what SSR ships and what
 *    the budget gates measure — no autoplay, no typed content, no counters
 *    that only finish on view.
 *  - NO figure on this band by decision: the Rondo round's battery lanes
 *    are C-11's CI gate + runbook, not committed receipts yet — an
 *    un-receipted number would be an invention, and the honesty rules
 *    cut the claim rather than soften it. The band's claims exit as
 *    receipted links out (docs + PRD).
 *  - Drift-pinned by `__tests__/chaconne.test.tsx`: the exact copy, the
 *    stills' paths/dims/alt/captions, and the no-number pin.
 */
export function ChaconneSection() {
  return (
    <section
      data-hue="aqua"
      id="chaconne"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The third user product">
            Chaconne — the repo's third app that left the terminal
          </SectionHead>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            {CHACONNE_LEDE}
          </p>
        </FadeUp>

        {/* The product tile: the identity pair of stills, framed in the shared chrome. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {CHACONNE_STILLS.map((s) => (
              <TerminalWindow key={s.src} title={`chaconne — ${s.caption}`}>
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
              the PRD, not in-page routes. */}
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint">
            {CHACONNE_LINKS.map((l, i) => (
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
