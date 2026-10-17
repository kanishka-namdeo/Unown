"use client";

import * as React from "react";
import { Glyph } from "./glyph";
import { WEIGHT } from "./glyphs";
import { FadeUp, SectionHead, ContinueArrow } from "./shell";

/**
 * The Pokédex card. Every line is either a short attributed quotation of game
 * text (commentary/quotation, with the source named) or a verifiable fact from
 * Bulbapedia / PokémonDB. No artwork, no sprites, no trademarks beyond naming
 * the thing this project is named after.
 */

const FACTS: [string, string][] = [
  ["Entry", "№ 0201 · Symbol · Psychic"],
  ["Japanese", "アンノーン — literally the word “Unknown”"],
  ["German", "Icognito — unknown + incognito"],
  ["French", "Zarbi — verlan, the slang that reverses syllables"],
  ["Ability", "Levitate — Ground-type moves pass straight through it"],
  ["Size", "0.5 m · 5.0 kg"],
  ["Where", "Ruins of Alph, Tanoby Ruins, Solaceon Ruins"],
  ["Forms", "26 letters since 1999; ! and ? arrived in 2004"],
];

type Borrowed = { t: string; d: React.ReactNode };

const BORROWED: Borrowed[] = [
  {
    t: "The letter is the body",
    d: (
      <>
        Unown&apos;s silhouette <em className="not-italic text-ink">is</em> the letter,
        which is why the hero here is a glyph with an eye rather than a symbol parked next
        to a wordmark. Every form carries one eye at the centre of its counter.
      </>
    ),
  },
  {
    t: "Two weights, one data set",
    d: (
      <>
        The script is 28 stroke paths on a 100×100 grid. Rendered at stroke weight
        {" "}
        {WEIGHT.heavy} it reads as a silhouette; at {WEIGHT.script} it reads as a letterform.
        One definition, two readings, no font file and no image sprite to download.
      </>
    ),
  },
  {
    t: "The punctuation is sleepy",
    d: (
      <>
        The only two forms with half-closed eyes are{" "}
        <code className="font-mono text-[11.5px] text-ink">!</code> and{" "}
        <code className="font-mono text-[11.5px] text-ink">?</code>. Ours are too, and they
        happen to be the two that describe the gates: verify-twice, and the question the loop
        exists to answer.
      </>
    ),
  },
  {
    t: "It appears where words are written",
    d: (
      <>
        Unown clings to walls in ruins, reading what is engraved there. Unown writes to{" "}
        <code className="font-mono text-[11.5px] text-ink">.unown/memory/project.md</code> in
        your repository. Same gesture, with version history and a rollback button.
      </>
    ),
  },
];

/** Read, not reproduced — facts and the odd peer-reviewed footnote. */
const SOURCES: { href: string; label: string; why: string }[] = [
  {
    href: "https://en.wikipedia.org/wiki/Unown",
    label: "Unown — Wikipedia",
    why: "form count, the Sugimori design origin, reception",
  },
  {
    href: "https://bulbapedia.bulbagarden.net/wiki/Unown_(Pok%C3%A9mon)",
    label: "Unown — Bulbapedia",
    why: "the Pokédex text and the biology details",
  },
  {
    href: "https://pokemondb.net/pokedex/unown",
    label: "Unown — Pokémon Database",
    why: "the per-generation entry table and localised names",
  },
  {
    href: "https://www.nsta.org/science-sampler-using-pokemon-alphabet-teach-classification-and-phylogeny",
    label: "Freidenberg & Kelly (2006), Science Scope",
    why: "a classroom taught phylogeny using nothing but these forms",
  },
  {
    href: "https://c.eev.ee/",
    label: "c.eev.ee",
    why: "a Pokémon database engineer rebuilt the alphabet in pure CSS",
  },
];

export function FieldNotesSection() {
  return (
    <section data-hue="psychic" id="field-notes" className="scroll-mt-16 border-y border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="Field notes"
            lead="A developer tool called unown has to explain itself twice. Both readings are below. The Pokémon side is lore, quoted and attributed; the engineering side is the part you can check."
          >
            On the name, and on the letters.
          </SectionHead>
        </FadeUp>

        <div className="mt-12 grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
          {/* the dex card */}
          <FadeUp>
            <div className="gb-panel overflow-hidden">
              <div className="flex items-start gap-4 border-b border-line p-5">
                <div className="grid size-16 shrink-0 place-items-center bg-canvas">
                  <Glyph id="?" weight="heavy" tone="lit" className="size-11 text-gold" />
                </div>
                <div className="min-w-0 pt-1">
                  <p className="gb-label text-[10px] text-gold">
                    Symbol
                  </p>
                  <p className="mt-1 text-lg font-medium leading-none text-ink">Unown</p>
                  <p className="mt-1.5 font-mono text-[10px] text-faint">アンノーン</p>
                </div>
              </div>

              <div className="space-y-2 border-b border-line px-5 py-4">
                {FACTS.map(([k, v]) => (
                  <div key={k} className="flex gap-3 text-[11.5px]">
                    <span className="gb-label w-16 shrink-0 text-[8px] text-faint">{k}</span>
                    <span className="min-w-0 text-dim">{v}</span>
                  </div>
                ))}
              </div>

              <figure className="p-5">
                <div className="gb-box p-4">
                  <blockquote className="quote text-[20px] leading-relaxed text-canvas">
                    “This Pokémon is shaped like ancient writing. It is a mystery as to which
                    came first, the ancient writings or the various UNOWN. Research into this
                    topic is ongoing but nothing is known.”
                  </blockquote>
                  <div className="mt-3 flex justify-end">
                    <ContinueArrow className="text-canvas" />
                  </div>
                </div>
                <figcaption className="mt-3 gb-label text-[9px] text-faint">
                  Pokédex · Ruby / Sapphire
                </figcaption>
                <p className="mt-4 text-[12px] leading-relaxed text-dim">
                  Engraved on the floor of the Ruins of Alph, in the same script, is a
                  sentence this project would like on its own tombstone:{" "}
                  <span className="text-ink">our words shall remain here for the ages</span>.
                  Project memory is exactly that sentence, with a version number.
                </p>
              </figure>
            </div>
          </FadeUp>

          {/* what we took */}
          <FadeUp delay={0.08}>
            <p className="gb-label text-[10px] text-gold">
              What we borrowed, and what we built
            </p>
            <div className="mt-5 border-t border-line">
              {BORROWED.map((entry) => (
                <div key={entry.t} className="border-b border-line py-5">
                  <h3 className="text-[14px] font-medium text-ink">{entry.t}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{entry.d}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[11px] leading-relaxed text-faint">
              Short quotations of game text appear here for commentary, with the source
              named on each one. No sprite, card, logo or audio from any Pokémon release is
              bundled, linked or reproduced. Independent project — not affiliated with,
              endorsed by or sponsored by Nintendo, Game Freak, Creatures Inc. or The
              Pokémon Company.
            </p>

            <div className="mt-6 border-t border-line pt-5">
              <p className="gb-label text-[9.5px] text-dim">
                Sources
              </p>
              <ul className="mt-3 space-y-1.5 text-[11.5px]">
                {SOURCES.map((s) => (
                  <li key={s.href}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-dim underline decoration-line underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
                    >
                      {s.label}
                    </a>
                    <span className="text-faint"> — {s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}