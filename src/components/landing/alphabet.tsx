"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Glyph, Mark } from "./glyph";
import { GLYPH_IDS, MARKS, type GlyphId, type MarkId } from "./glyphs";
import { LEXICON_BY_ID } from "./lexicon";
import { useLetterRain } from "./effects";
import { FadeUp, SectionHead, TerminalWindow, PixelCursor } from "./shell";

/* ------------------------------------------------------------------ */
/* background marks                                                    */
/* ------------------------------------------------------------------ */

const MARK_KEYS = Object.keys(MARKS) as MarkId[];

/**
 * The alphabet has a language around it: a field of the non-letter marks, at
 * the kind of opacity you only notice once you've looked for it. Positions are
 * a fixed table rather than random so the field never reflows between renders.
 */
const FIELD = [
  [4, 8], [26, 62], [48, 14], [70, 40], [88, 18], [12, 78], [36, 44],
  [58, 76], [80, 88], [92, 58], [18, 30], [44, 92], [64, 30], [6, 50],
] as const;

function MarkField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="unown-flicker absolute inset-0">
        {FIELD.map(([x, y], i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-ink"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <Mark id={MARK_KEYS[i % MARK_KEYS.length]} className="size-9 sm:size-11" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one form                                                            */
/* ------------------------------------------------------------------ */

function FormTile({
  id,
  active,
  onHover,
  onPick,
}: {
  id: GlyphId;
  active: boolean;
  onHover: (id: GlyphId | null) => void;
  onPick: (id: GlyphId) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(id)}
      onFocus={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(id)}
      aria-pressed={active}
      className={`lift group relative flex aspect-square flex-col items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-glow focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
        active ? "gb-box" : "gb-panel hover:border-line-bright"
      }`}
    >
      {active ? (
        <PixelCursor className="absolute left-1.5 top-1.5 size-2 text-canvas" />
      ) : null}
      <Glyph
        id={id}
        weight="heavy"
        tone={active ? "lit" : "dim"}
        className={`h-[58%] w-[58%] transition-colors duration-100 ${
          active ? "text-canvas" : "text-faint group-hover:text-dim"
        }`}
      />
      <span
        className={`mt-1 gb-label text-[8px] transition-colors ${
          active ? "text-canvas" : "text-dim"
        }`}
      >
        {id}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function AlphabetSection() {
  // Pinned, not hovered, so the panel is never empty — touch devices have no
  // hover, and a blank panel reads as a broken component.
  const [pinned, setPinned] = React.useState<GlyphId>("U");
  const [hovered, setHovered] = React.useState<GlyphId | null>(null);
  const { rain } = useLetterRain();
  const active = hovered ?? pinned;
  const entry = LEXICON_BY_ID.get(active)!;
  const ordinal = GLYPH_IDS.indexOf(entry.id) + 1;

  return (
    <section
      id="alphabet"
      className="relative scroll-mt-16 overflow-hidden border-y border-line py-20 sm:py-24"
    >
      <MarkField />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-6 max-w-2xl">
          <FadeUp>
            <SectionHead kicker="The alphabet">
              The name is a pun you have to read twice.
            </SectionHead>
          </FadeUp>
          <FadeUp delay={0.06}>
            <p className="text-pretty leading-relaxed text-dim">
              <span className="text-ink">un</span>own. Unown is the <em>Symbol Pokémon</em> —
              a flat black letter with one eye, alive since 1999, found stuck to walls in
              ruins, shaped like writing on very old tablets. It is the only word in the
              franchise that is a typo of itself.
            </p>
          </FadeUp>
          <FadeUp delay={0.12}>
            <p className="text-pretty leading-relaxed text-dim">
              Which is the whole thesis for an agent with memory: the interesting thing
              about it is that it <span className="text-ink">reads</span>. So the 28 forms
              below are ours, drawn from scratch as inline SVG — no font file, no image
              sprite. Each one decodes twice: the lore it borrows, and the real mechanism
              it stands for here.
            </p>
          </FadeUp>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          {/* the forms */}
          <FadeUp className="lg:order-1">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {GLYPH_IDS.map((id) => (
                <FormTile
                  key={id}
                  id={id}
                  active={id === active}
                  onHover={setHovered}
                  onPick={(next) => {
                    setPinned(next);
                    rain(next);
                  }}
                />
              ))}
            </div>
            <p className="mt-4 font-mono text-[11px] text-faint">
              hover or focus to decode · click to pin it and rain the letter
            </p>
          </FadeUp>

          {/* the decoding */}
          <FadeUp delay={0.08} className="lg:order-2">
            <div className="lg:sticky lg:top-24">
              <TerminalWindow title={`form ${ordinal} / 28 · ${entry.id}`}>
                <div aria-live="polite" className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="grid size-16 shrink-0 place-items-center border-[3px] border-canvas bg-glow/10">
                      <Glyph id={entry.id} weight="heavy" tone="lit" className="size-11 text-glow" />
                    </div>
                    <div className="min-w-0">
                      <p className="gb-term text-[24px] leading-none text-ink">{entry.id}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                        form {ordinal} / 28
                      </p>
                    </div>
                  </div>

                  <figure className="mt-5 border-t border-line pt-4">
                    <blockquote className="quote font-term text-[15px] italic leading-relaxed text-dim">
                      {entry.lore}
                    </blockquote>
                    <figcaption className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
                      {entry.loreSrc ?? "Unown"}
                    </figcaption>
                  </figure>

                  <div className="mt-5 border-t border-line pt-4">
                    <p className="gb-label text-[9px] text-glow">
                      in unown
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink">{entry.means}</p>
                    {entry.proof ? (
                      <p className="mt-3 inline-block border border-line bg-canvas/60 px-2 py-0.5 font-mono text-[10px] text-faint">
                        {entry.proof}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TerminalWindow>
            </div>
          </FadeUp>
        </div>

        <p className="mt-10 max-w-3xl text-[11px] leading-relaxed text-faint">
          Every line under <span className="text-dim">in unown</span> describes something
          that actually runs in this repository. An independent open-source project — not
          affiliated with, endorsed by or sponsored by Nintendo, Game Freak, Creatures Inc.
          or The Pokémon Company. Pokémon and Unown are trademarks of their respective
          owners.
        </p>
      </div>
    </section>
  );
}