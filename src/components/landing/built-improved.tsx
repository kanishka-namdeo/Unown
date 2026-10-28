"use client";

import { ArrowRight } from "lucide-react";
import {
  IMPROVEMENT_RECEIPTS,
  LEARNING_COUNTERS,
  MISSION_CONTROL_STILLS,
  REPORT_LINKS,
} from "./built-improved-data";
import { LIVE_DEMO_APPS } from "./live-demo-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * "Built & Improved With Unown" — the improvement-evidence band over the
 * live-demo gallery (band order: it sits between the gallery and the
 * proof panes). The gallery shows WHAT the agent built, running live;
 * this band shows the measured evidence that the agent CHANGED while
 * building it — the before/after improvement receipts, the learning-lane
 * counters, and the Mission Control surfaces where the loop is visible.
 *
 * Honesty rules (inherited): every figure cites a committed receipt
 * (`built-improved-data.ts` — drift-pinned by `__tests__/
 * built-improved.test.tsx`); the app count derives from the gallery's
 * own data file (never duplicated); unmeasured prints "not measured".
 * The stills are existing Mission Control captures, reused (the media
 * lane never regenerates for a new consumer).
 */
export function BuiltImprovedSection() {
  return (
    <section
      data-hue="gold"
      id="built-improved"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The showcase, continued">
            Built &amp; improved with Unown.
          </SectionHead>
          <p className="mt-4 text-[15px] leading-relaxed text-dim">
            The apps above were written end-to-end by the agent, unedited.
            This is the other half of the claim: while it built them, its own
            loop ran — and these receipts are what measurably changed.
          </p>
        </FadeUp>

        {/* The before/after receipts — two cards, each proving both ends. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-4 md:grid-cols-2">
            {IMPROVEMENT_RECEIPTS.map((r) => (
              <article key={r.id} className="gb-inset rounded-lg p-4">
                <p className="gb-label text-[9px] text-gold">before → after</p>
                <h3 className="mt-2 text-[14px] font-semibold text-ink">{r.title}</h3>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="rounded bg-ink/10 px-2 py-0.5 font-mono text-[11.5px] text-dim">
                    {r.before}
                  </span>
                  <span aria-hidden className="text-gold">
                    →
                  </span>
                  <span className="rounded bg-gold/15 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-ink">
                    {r.after}
                  </span>
                </p>
                <a
                  href={r.receipt}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-gold underline-offset-4 hover:underline"
                >
                  the receipt <ArrowRight className="size-3" aria-hidden />
                </a>
              </article>
            ))}
          </div>
        </FadeUp>

        {/* The learning-lane counters — one strip, every number receipted. */}
        <FadeUp delay={0.1} className="mt-5">
          <dl className="gb-inset grid grid-cols-3 gap-px overflow-hidden rounded-lg sm:grid-cols-6">
            {LEARNING_COUNTERS.map((c) => (
              <div key={c.label} className="px-3.5 py-3">
                <dd className="gb-numeral text-[20px] leading-none text-ink">{c.value}</dd>
                <dt className="gb-label mt-1.5 text-[9px] text-gold">{c.label}</dt>
              </div>
            ))}
          </dl>
        </FadeUp>

        {/* Mission Control — where the loop is visible, not inferred. */}
        <FadeUp delay={0.14} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {MISSION_CONTROL_STILLS.map((s) => (
              <TerminalWindow key={s.src} title={`unown dashboard — ${s.caption.split(":")[0].toLowerCase()}`}>
                <figure className="m-0">
                  <img
                    src={s.src}
                    alt={s.alt}
                    width={1792}
                    height={1008}
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
        </FadeUp>

        {/* The exits — the three reports are the longhand lanes. */}
        <FadeUp delay={0.18} className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {REPORT_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-dim underline-offset-4 hover:text-ink hover:underline"
            >
              {l.label} <ArrowRight className="size-3" aria-hidden />
            </a>
          ))}
        </FadeUp>
      </div>
    </section>
  );
}
