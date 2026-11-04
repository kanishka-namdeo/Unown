"use client";

import { Fragment } from "react";
import {
  OSTINATO_BATTERY_FIGURE,
  OSTINATO_LEDE,
  OSTINATO_LINKS,
  OSTINATO_STILLS,
} from "./ostinato-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * The "the second user product" band — Ostinato, the repo's second
 * self-contained user-facing app (`apps/ostinato/`), the Ostinato round's
 * artifact (2026-11-04): a keyboard-first, offline-first
 * spaced-repetition flashcard PWA.
 *
 * Contract notes (the Coda band's shape, applied to the second product):
 *  - A NEW band, not a gallery entry: every `LIVE_DEMO_APPS` row iframes a
 *    LANDING ROUTE; Ostinato is a static PWA served by
 *    `apps/ostinato/serve.mjs`, NOT a route in `src/app/`, so it cannot
 *    join the gallery's same-origin iframe + reset-handshake contract.
 *    The band says its own truth in its own words instead.
 *  - The stills are the round's own capture lane's real output
 *    (`public/landing/ostinato/`, captured keyboard-only through the real
 *    UI by `apps/ostinato/scripts/capture-usage.mjs`), framed in the
 *    shared TerminalWindow chrome; declared dims are the PNGs' real IHDR
 *    (2560×1600), re-checked by `__tests__/ostinato.test.tsx` against the
 *    files on disk.
 *  - STATIC by construction: the finished state is what SSR ships and what
 *    the budget gates measure — no autoplay, no typed content, no counters
 *    that only finish on view.
 *  - The only figure the band carries is the O-4/O-5 hardening battery
 *    (its receipt run `benchmarks/ostinato/receipts/run-20261104T181704Z/`),
 *    printed with its caveats verbatim — the external verifier is the
 *    point, the timing is the environment's. No invented numbers; the
 *    band's other claims are receipted links out.
 *  - Drift-pinned by `__tests__/ostinato.test.tsx`: every number the band
 *    may render belongs to the test's literal set, and the stills exist on
 *    disk with their real IHDR dims.
 */
export function OstinatoSection() {
  return (
    <section
      data-hue="leaf"
      id="ostinato"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The second user product">
            Ostinato — the repo's second app that left the terminal
          </SectionHead>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            {OSTINATO_LEDE}
          </p>
        </FadeUp>

        {/* The product tile: the identity pair of stills, framed in the shared chrome. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {OSTINATO_STILLS.map((s) => (
              <TerminalWindow key={s.src} title={`ostinato — ${s.caption}`}>
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

          {/* The band's one receipted figure — printed with its caveats
              verbatim (the Coda precedent: one figure, caveats verbatim).
              The receipt itself lives in the benchmark lane, linked below. */}
          <p className="mt-4 font-mono text-[10px] text-faint">
            {OSTINATO_BATTERY_FIGURE}
          </p>

          {/* The receipt exits — absolute GitHub links into the docs and
              the benchmark lane, not in-page routes. */}
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint">
            {OSTINATO_LINKS.map((l, i) => (
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
