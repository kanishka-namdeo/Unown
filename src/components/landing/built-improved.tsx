"use client";

import { Fragment } from "react";
import {
  IMPROVEMENT_RECEIPTS,
  LOOP_RECEIPTS,
  MISSION_CONTROL_STILLS,
  RECEIPT_LINKS,
} from "./built-improved-data";
import { LIVE_DEMO_APPS } from "./live-demo-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/** Ordinals through ninth, then the bare `Nth` form — the gallery count
 * renders as a word, never a duplicated figure. Exported so the suite can
 * pin the derivation the lead sentence renders. */
const ORDINALS = [
  "",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
] as const;

export function ordinalOf(n: number): string {
  const word = ORDINALS[n];
  return word ? word : `${n}th`;
}

/**
 * "Built & Improved With Unown" — the SOTA round's showcase band over the
 * live-demo gallery (band order: it sits between the gallery and the proof
 * panes). The gallery shows WHAT the agent built, running live; this band
 * shows what its learning loop produced while it built — the receipts
 * themselves, receipts first.
 *
 * Contract notes (the round's own):
 *  - STATIC by construction: every figure and every still ships in the
 *    server-rendered DOM at its finished state — no autoplaying screens,
 *    no typed lines, no counters that only finish on view. The scroll
 *    budget gates measure the page at replay-finished; this band is always
 *    already there.
 *  - Every figure is receipt-backed (`built-improved-data.ts` — the sources
 *    are named there; drift-pinned by `__tests__/built-improved.test.tsx`,
 *    which re-extracts every number from the data against a literal set).
 *  - The gallery's app count derives from LIVE_DEMO_APPS at render time
 *    (never a duplicated constant), so the lede gains the gallery's sixth
 *    app automatically when the next round ships one.
 *  - The stills are the round's own Mission Control captures (the SOTA
 *    round's capture lane), framed in the shared TerminalWindow chrome;
 *    declared dims are the PNGs' real IHDR, which the dex-media gate
 *    re-checks against the files.
 *  - The three receipt links are plain anchors to committed docs — the
 *    longhand lanes. No CopyButton, no blog routes.
 */
export function BuiltImprovedSection() {
  const galleryNth = ordinalOf(LIVE_DEMO_APPS.length);
  return (
    <section
      data-hue="gold"
      id="built-improved"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="The SOTA round"
            lead={`The round built Fugue (the gallery's ${galleryNth} app) while the learning loop watched — here is what it minted, remembered, and proved, receipts first.`}
          >
            Built &amp; Improved With Unown
          </SectionHead>
        </FadeUp>

        {/* The receipts themselves: the loop's tally left, the screens it
            left on right. Two columns, one grid — the band pays for its own
            height, and the stills ride their native aspect at cell width. */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <h3 className="gb-label text-[9px] text-gold">
                The loop&apos;s receipts
              </h3>
              <ul className="mt-4 grid gap-3">
                {LOOP_RECEIPTS.map((r) => (
                  <li
                    key={r.id}
                    data-spotlight
                    className="gb-panel lift p-4 hover:border-line-bright"
                  >
                    <p className="font-mono text-[11.5px] font-semibold leading-snug text-ink">
                      {r.figure}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
                      {r.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {MISSION_CONTROL_STILLS.map((s) => (
                <TerminalWindow
                  key={s.src}
                  title={`unown dashboard — ${s.caption.split("— ")[1].toLowerCase()}`}
                >
                  <figure className="m-0">
                    <img
                      src={s.src}
                      alt={s.alt}
                      width={1792}
                      height={1042}
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
          </div>
        </FadeUp>

        {/* The before/after improvements — the loop's two closed, retained
            fixes (carried from the parley round's v0.0.38 band; the
            mission's core exhibit: a failure became a shipped patch, and
            the fix survives reruns). */}
        <FadeUp delay={0.08} className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {IMPROVEMENT_RECEIPTS.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-line bg-panel-2 p-4"
              >
                <p className="text-[13px] font-medium text-ink">{r.title}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] leading-relaxed">
                  <span className="rounded bg-line px-1.5 py-0.5 text-faint">
                    before
                  </span>
                  <span className="text-dim">{r.before}</span>
                  <span aria-hidden="true" className="text-faint">
                    →
                  </span>
                  <span className="rounded bg-line px-1.5 py-0.5 text-faint">
                    after
                  </span>
                  <span className="text-ink">{r.after}</span>
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-dim">
                  {r.loop}
                </p>
                <a
                  href={r.receipt}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-mono text-[10px] text-faint underline decoration-line underline-offset-4 hover:text-ink"
                >
                  the receipt
                </a>
              </div>
            ))}
          </div>
        </FadeUp>

        {/* The exits: the round's three longhand lanes, committed docs. */}
        <FadeUp delay={0.1} className="mt-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint">
            <span>Receipts:</span>
            {RECEIPT_LINKS.map((l, i) => (
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
