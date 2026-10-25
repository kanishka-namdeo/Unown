"use client";

import * as React from "react";
import { Glyph, Mark } from "./glyph";
import { GLYPH_IDS, MARKS, type GlyphId, type MarkId } from "./glyphs";
import { LEXICON_BY_ID } from "./lexicon";
import { useLetterRain } from "./effects";
import { FadeUp, SectionHead, TerminalWindow, PixelCursor, toneAttr, type Tone } from "./shell";

/**
 * The alphabet band — the page's identity section, and since 2026-10-20 also
 * the home of the field notes. The glyph wall + decode panel stay (they are
 * the signature interaction: 28 hand-drawn SVG forms, each decoding twice);
 * the borrowed-essays column became a sources footnote. One highlight quote
 * survives instead of three — the decode panel already carries all 28
 * entries, and the wall itself is the argument. The static Unown trading
 * card (the old DexCard) retired the same day the capability dex arrived:
 * its facts mostly restated the hero seal's (№ 0201, アンノーン, Symbol ·
 * Psychic), and the one fact unique to it — ! and ? arrived in 2004 — moved
 * into the intro sentence below.
 *
 * 2026-10-23 light shrink (the "do we need this band?" round — answer: yes,
 * but slimmer): the intro and the Z highlight stopped stacking full-width —
 * the highlight now sits in a card beside the intro on desktop (the row was
 * ~60% dead whitespace at 1440) and falls under it on mobile; the intro lost
 * its one ornamental clause ("stuck to walls in ruins") and kept every
 * checkable fact; padding, gaps and the fine-print block tightened. All 28
 * tiles, the panel, the Konami hint, the lore and the non-affiliation
 * paragraph are untouched.
 */

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

/**
 * The 28 forms cycle the four hues that are NOT their section's own. The
 * alphabet sits on `psychic`, so the wall cycles aqua / leaf / magma / gold:
 * each tile is a labelled drawer with a lit rim in its hue, and the pinned one
 * fills with it. Cycling by index is a fixed pattern, not random, so the field
 * is stable between renders and does not reflow.
 */
const TILE_TONES: readonly Tone[] = ["aqua", "leaf", "magma", "gold"];

/**
 * One form lifted out of the wall so the lexicon is readable without hovering
 * anything: the Z decode is the model-agnostic objection, answered by an
 * alphabet. Read from `LEXICON_BY_ID` so the quotation and its attribution
 * stay single-sourced with the panel.
 */
const HIGHLIGHT: GlyphId = "Z";

function FormTile({
  id,
  tone,
  active,
  onHover,
  onPick,
}: {
  id: GlyphId;
  tone: Tone;
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
      {...toneAttr(tone)}
      className={`lift group relative flex aspect-square flex-col items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
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
  const highlight = LEXICON_BY_ID.get(HIGHLIGHT)!;

  return (
    <section
      data-hue="psychic"
      id="alphabet"
      className="relative scroll-mt-16 overflow-hidden border-t border-line py-16 sm:py-[72px]"
    >
      <MarkField />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        {/* Header row: intro left, the Z highlight beside it on desktop (the
            stacked row was ~60% dead whitespace at 1440 — 2026-10-23 light
            shrink), stacked under it on mobile. The highlight stays static and
            pointer-free: lore must be readable without interacting. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:gap-10">
          <div className="max-w-2xl">
            <FadeUp>
              <SectionHead kicker="The alphabet">
                The name is a pun you have to read twice.
              </SectionHead>
            </FadeUp>
            <FadeUp delay={0.06}>
              <p className="text-pretty leading-relaxed text-dim">
                <span className="text-ink">un</span>own — the <em>Symbol Pokémon</em>: a
                flat black letter with one eye, alive since 1999. Twenty-six forms
                at first, ! and ? in 2004; the 28 below are drawn from scratch as
                inline SVG — no font file, no sprite — each decoding twice: the
                lore it borrows, the mechanism it stands for.
              </p>
            </FadeUp>
          </div>
          <FadeUp delay={0.12}>
            <figure className="border border-line bg-panel/60 p-4">
              <div className="flex items-center gap-3">
                <Glyph id={highlight.id} weight="heavy" className="size-9 shrink-0 text-gold" />
                <figcaption className="gb-label text-[9px] leading-relaxed text-faint">
                  one of twenty-eight ·
                  <br />
                  the rest are in the wall
                </figcaption>
              </div>
              <blockquote className="quote mt-3 text-pretty text-[14px] italic leading-relaxed text-dim">
                {highlight.lore}
              </blockquote>
              <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                {highlight.loreSrc}
              </p>
            </figure>
          </FadeUp>
        </div>

        <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          {/* the forms */}
          <FadeUp className="lg:order-1">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-2">
              {GLYPH_IDS.map((id, i) => (
                <FormTile
                  key={id}
                  id={id}
                  tone={TILE_TONES[i % TILE_TONES.length]}
                  active={id === active}
                  onHover={setHovered}
                  onPick={(next) => {
                    setPinned(next);
                    rain(next);
                  }}
                />
              ))}
            </div>
            <p className="mt-3 font-mono text-[11px] text-faint">
              hover or focus to decode · click to pin it and rain the letter · psst, try
              ↑↑↓↓←→←→ba
            </p>
          </FadeUp>

          {/* the decoding panel — the dex card retired 2026-10-20 (see the
              band comment above) */}
          <FadeUp delay={0.08} className="lg:order-2">
            <TerminalWindow title={`form ${ordinal} / 28 · ${entry.id}`}>
              <div aria-live="polite" className="p-4">
                <div className="flex items-center gap-4">
                  <div className="grid size-16 shrink-0 place-items-center border-[3px] border-canvas bg-gold/10">
                    <Glyph id={entry.id} weight="heavy" tone="lit" className="size-11 text-gold" />
                  </div>
                  <div className="min-w-0">
                    <p className="gb-term text-[24px] leading-none text-ink">{entry.id}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      form {ordinal} / 28
                    </p>
                  </div>
                </div>

                <figure className="mt-4 border-t border-line pt-3">
                  <blockquote className="quote font-term text-[15px] italic leading-relaxed text-dim">
                    {entry.lore}
                  </blockquote>
                  <figcaption className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
                    {entry.loreSrc ?? "Unown"}
                  </figcaption>
                </figure>

                <div className="mt-4 border-t border-line pt-3">
                  <p className="gb-label text-[9px] text-gold">
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
          </FadeUp>
        </div>

        <div className="mt-8 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="gb-label text-[9px] text-faint">Field notes read at</span>
            {[
              ["Wikipedia", "https://en.wikipedia.org/wiki/Unown"],
              ["Bulbapedia", "https://bulbapedia.bulbagarden.net/wiki/Unown_(Pok%C3%A9mon)"],
              ["PokémonDB", "https://pokemondb.net/pokedex/unown"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-[10.5px] text-dim underline decoration-line underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
              >
                {label}
              </a>
            ))}
          </div>
          <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-faint">
          Every line under <span className="text-dim">in unown</span> describes something
          that runs here. Game-text quotations appear for commentary, sources named; no
          Pokémon sprite, card, logo or audio is bundled or reproduced. Open-source
          project — not affiliated with, endorsed by or sponsored by Nintendo, Game Freak,
          Creatures Inc. or The Pokémon Company. Pokémon and Unown remain their
          owners&apos; trademarks.
          </p>
        </div>
      </div>
    </section>
  );
}
