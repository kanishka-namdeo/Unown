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
    body: "pi's TUI, in your real project directory, with the resolved memory stack injected into every prompt and guardrail hooks riding along. On its own this is a good coding agent that forgets everything at midnight.",
    lines: ["unown", "unown -p …", "unown --plan", "unown doctor", "unown memory"],
  },
  {
    glyph: "B" as const,
    title: "The engine behind it",
    body: "Sandboxed harness cycles, a verify-gated ship rule, seven background jobs and AutoDream consolidation. It never touches your editor. It exists to notice what you keep getting wrong and write it down.",
    lines: [
      "harness-cycle   10m",
      "auto-dream      10m",
      "note-sync        5m",
      "task-mint       30m",
      "sandbox-gc      15m",
    ],
  },
];

function Pair() {
  return (
    <div className="gb-panel p-6" data-tone="cream">
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
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-glow">
          the odd power
        </span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span className="font-mono text-[11px] text-ink">
          session notes → memory → skills → a better next session
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
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          {/* left: the two quotes that explain the architecture */}
          <div>
            <FadeUp>
              <p className="gb-label text-[10px] text-glow">
                Why it is built this way
              </p>
              <h2 className="mt-3 font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                When alone, nothing happens.
              </h2>
              <p className="mt-4 max-w-md text-pretty leading-relaxed text-dim">
                The best line in the Pokédex is an accidental description of distributed
                systems, and it is the design brief for everything in this repository.
              </p>
            </FadeUp>

            <FadeUp delay={0.08}>
              <figure className="relative mt-8 gb-box p-5" data-tone="cream">
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
                  yesterday. Add the engine and something else appears: notes taken at the
                  end of every session, failures mined overnight, patches that are only
                  allowed to land if a sandbox proves them twice.
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-dim">
                  Neither half is clever. The loop between them is the product.
                </p>
              </div>
            </FadeUp>

            <FadeUp delay={0.2}>
              <figure className="relative mt-10 gb-box p-5" data-tone="cream">
                <blockquote className="quote text-pretty text-lg leading-relaxed text-canvas italic sm:text-xl">
                  “{DEX_QUOTES.origin}”
                </blockquote>
                <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-canvas/90">
                  {DEX_QUOTES.originSrc}
                </figcaption>
                <ContinueArrow className="absolute bottom-2 right-3 text-canvas" />
              </figure>
              <p className="mt-4 text-[13px] leading-relaxed text-dim">
                Take the other half seriously and you get this project&apos;s whole thesis
                in one line: which came first, the code you wrote, or the agent that
                read it? Unown keeps betting on the second, and then{" "}
                <span className="text-ink">versioning the answer</span> so you can roll it
                back when the bet is wrong.
              </p>
            </FadeUp>
          </div>

          {/* right: the pair, then the pipeline */}
          <FadeUp delay={0.1}>
            <Pair />
          </FadeUp>
        </div>

        {/* the three acts, named once, then expanded in the next section */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mt-16 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3"
        >
          {[
            {
              k: "01",
              t: "Work",
              d: "You chat in your terminal. Hooks watch every tool call. A note is written on the way out.",
            },
            {
              k: "02",
              t: "Learn",
              d: "The harness runs the suite in a fresh sandbox, mines whatever failed, and drafts memory rules that would have prevented it.",
            },
            {
              k: "03",
              t: "Dream",
              d: "AutoDream consolidates notes into project memory and mints skills — canary-gated, so a bad dream rolls itself back.",
            },
          ].map((act) => (
            <div key={act.k} className="bg-panel p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-glow">
                {act.k}
              </p>
              <h3 className="mt-2 text-lg font-medium">{act.t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{act.d}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}