"use client";

import { Fragment } from "react";
import { CODA_LINKS, CODA_LEDE, CODA_STILLS } from "./coda-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * The "the first user product" band — Coda, the repo's first self-contained
 * user-facing app (`apps/coda/`), the Coda round's artifact and the
 * doc-truth round's T3 capture.
 *
 * Contract notes:
 *  - A NEW band, not a gallery entry: every `LIVE_DEMO_APPS` row iframes a
 *    LANDING ROUTE (`/demo`, `/bazaar`, … `/ledger`); Coda is a static PWA
 *    served by `apps/coda/scripts/serve.mjs`, NOT a route in `src/app/`, so
 *    it cannot join the gallery's same-origin iframe + reset-handshake
 *    contract. The band says its own truth in its own words instead.
 *  - The stills are the T3 capture lane's real output
 *    (`public/landing/coda/`, captured through the real UI by
 *    `apps/coda/scripts/capture-usage.mjs`), framed in the shared
 *    TerminalWindow chrome (the gallery's own visual language for stills);
 *    declared dims are the PNGs' real IHDR (2560×1600), which the
 *    dex-media gate re-checks against the files.
 *  - STATIC by construction: the finished state is what SSR ships and what
 *    the budget gates measure — no autoplay, no typed content, no counters
 *    that only finish on view.
 *  - The only figure the band carries is the T2 receipt's offline
 *    boot-from-cache delta, printed with its caveats verbatim — the DELTA
 *    is the signal, the absolute ms are the environment's. No invented
 *    numbers; the band's other claims are receipted links out.
 *  - Drift-pinned by `__tests__/coda.test.tsx`: every number the band may
 *    render belongs to the data module's literal set, and the stills
 *    exist on disk with their real IHDR dims.
 */
export function CodaSection() {
  return (
    <section
      data-hue="aqua"
      id="coda"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The first user product">
            Coda — the repo's first app that left the terminal
          </SectionHead>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            {CODA_LEDE}
          </p>
        </FadeUp>

        {/* The product tile: the two stills, framed in the shared chrome. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {CODA_STILLS.map((s) => (
              <TerminalWindow key={s.src} title={`coda — ${s.caption}`}>
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

          {/* The receipt exits — the figure + caveats live in the receipt
              lane, not on the page (the honesty rule: no figure without a
              checkable receipt on the page itself). */}
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint">
            {CODA_LINKS.map((l, i) => (
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
