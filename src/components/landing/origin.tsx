"use client";

import { motion } from "framer-motion";
import { Glyph } from "./glyph";
import { DEX_QUOTES } from "./lexicon";
import { ContinueArrow, FadeUp } from "./shell";

/* ------------------------------------------------------------------ */
/* two of them                                                         */
/* ------------------------------------------------------------------ */

const TWO = [
  {
    glyph: "A" as const,
    title: "The terminal agent",
    body: "pi's TUI, in your real project directory, with the memory stack already loaded. On its own this is a good coding agent that forgets everything at midnight.",
    lines: ["unown", "unown -p …", "unown --plan", "unown doctor", "unown memory"],
  },
  {
    glyph: "B" as const,
    title: "The engine behind it",
    body: "Sandboxed harness cycles and AutoDream consolidation, on a clock instead of in your session. It never touches your editor.",
    lines: [
      "harness-cycle   10m",
      "auto-dream      10m",
      "note-sync        5m",
      "task-mint       30m",
      "sandbox-gc      15m",
      "on improvement:shipped",
      "on run:finished",
    ],
  },
];

function Pair() {
  return (
    <div className="gb-panel p-6">
      <div className="flex items-stretch gap-4">
        {TWO.map((half, i) => (
          <div key={half.glyph} className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3">
              <Glyph
                id={half.glyph}
                weight="heavy"
                className="size-9 shrink-0 text-ink"
              />
              <h3 className="text-sm font-medium text-ink">{half.title}</h3>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-dim">{half.body}</p>
            <ul className="mt-4 space-y-1">
              {half.lines.map((l) => (
                <li key={l} className="font-mono text-[11px] text-faint">
                  {l}
                </li>
              ))}
            </ul>
            {i === 0 ? (
              <div
                aria-hidden="true"
                className="mt-4 self-center font-mono text-xl text-faint lg:hidden"
              >
                +
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-4 border-t border-line pt-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          the odd power
        </span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span className="font-mono text-[11px] text-ink">
          notes → memory → a better next session
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function OriginSection() {
  return (
    <section data-hue="aqua" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          {/* left: the two quotes that explain the architecture */}
          <div>
            <FadeUp>
              <p className="gb-label text-[10px] text-gold">
                Why it is built this way
              </p>
              <h2 className="mt-3 font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Alone, it is only half a tool.
              </h2>
              <p className="mt-4 max-w-md text-pretty leading-relaxed text-dim">
                The dex settles it: the interesting part starts at two.
              </p>
            </FadeUp>

            <FadeUp delay={0.08}>
              <figure className="relative mt-8 gb-box p-5">
                <blockquote className="quote text-pretty text-2xl leading-snug text-canvas italic sm:text-3xl">
                  “{DEX_QUOTES.emergent}”
                </blockquote>
                <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-canvas/90">
                  {DEX_QUOTES.emergentSrc}
                </figcaption>
                <ContinueArrow className="absolute bottom-2 right-3 text-canvas" />
              </figure>
            </FadeUp>

            <FadeUp delay={0.14}>
              <div className="mt-8 border-l border-line pl-5">
                <p className="text-[13px] leading-relaxed text-dim">
                  Run <span className="font-mono text-ink">unown</span> on its own and you
                  have a coding agent with very good manners and a total memory of
                  yesterday. Add the engine and something else appears: notes at the end of
                  every session, failures mined overnight, and a memory file you can read
                  tomorrow.
                </p>
              </div>
            </FadeUp>

            {/* The dex's "which came first" line, asked back at the product. The
                quotation itself lives in the dex card in `field-notes.tsx`; printing
                it here too put the same 33 words on the page twice, and this paragraph
                carries the argument without it. */}
            <FadeUp delay={0.2}>
              <p className="mt-10 text-[13px] leading-relaxed text-dim">
                The other half asks the question back: which came first, the code you
                wrote, or the agent that read it? Unown keeps betting on the second, and
                then{" "}
                <span className="text-ink">versioning the answer</span> so you can roll
                the bet back when it is wrong.
              </p>
            </FadeUp>
          </div>

          {/* right: the pair, then the pipeline */}
          <FadeUp delay={0.1}>
            <Pair />
          </FadeUp>
        </div>

        {/* The pipeline. This used to be three cells that faded in together and
            whose bodies restated `loop.tsx` almost sentence for sentence — the
            page's only sequence, presented as simultaneity, one section before the
            section that owns it. It is now a stepped reveal with a rail, so the
            cards arrive in the order they happen, and each body is one line that
            says what the act is for rather than re-describing the gate that
            `integrity.tsx` already tabulates. */}
        <div className="mt-16">
          <motion.div
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-px h-px origin-left bg-line"
            aria-hidden="true"
          />
          <ol className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3">
            {[
              {
                k: "01",
                t: "Work",
                d: "Hooks watch every tool call. A note is written on the way out.",
              },
              {
                k: "02",
                t: "Learn",
                d: "The suite runs somewhere you cannot see, and whatever failed gets mined.",
              },
              {
                k: "03",
                t: "Dream",
                d: "Notes become memory, and skills get minted while you sleep.",
              },
            ].map((act, i) => (
              <motion.li
                key={act.k}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.45, delay: 0.15 + i * 0.14 }}
                className="bg-panel p-6"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">
                  {act.k}
                </p>
                <h3 className="mt-2 text-lg font-medium">{act.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-dim">{act.d}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}