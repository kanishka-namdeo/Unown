"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Glyph } from "./glyph";
import { GLYPHS, type GlyphId } from "./glyphs";
import { useAlphabetWake } from "./effects";
import { FadeUp, GITHUB_URL, DOCS_URL } from "./shell";

const DEFAULT_WORD = "UNKNOWN";
const MAX = 9;

/* ------------------------------------------------------------------ */
/* spell a word                                                        */
/* ------------------------------------------------------------------ */

function Spellbox() {
  const [raw, setRaw] = React.useState(DEFAULT_WORD);
  const letters = React.useMemo(
    () =>
      raw
        .toUpperCase()
        .split("")
        .filter((c) => /[A-Z!?]/.test(c)) as GlyphId[],
    [raw],
  );
  const shown = letters.slice(0, MAX);
  const known = letters.length === 0;

  return (
    <div className="rounded-lg border border-line bg-panel/70 p-5">
      <label
        htmlFor="spellbox"
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-glow"
      >
        spell it in unown
      </label>

      <div className="mt-3 flex items-center gap-3 border-b border-line pb-2 focus-within:border-glow/60">
        <span aria-hidden="true" className="font-mono text-sm text-faint">
          $
        </span>
        <input
          id="spellbox"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^A-Za-z!?\s]/g, ""))}
          maxLength={MAX}
          spellCheck={false}
          autoComplete="off"
          placeholder="type anything"
          className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-faint/60"
        />
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
          {shown.length}/{MAX}
        </span>
      </div>

      {/* the word, in the script — the Latin text is always present for anyone
          who cannot or does not want to read the glyphs */}
      <div
        className="mt-5 min-h-24"
        aria-live="polite"
        aria-label={known ? "no letters yet" : `${raw.toUpperCase()} spelled in Unown`}
      >
        {known ? (
          <p className="font-mono text-[11px] text-faint">
            a letter, or one of the two punctuation forms
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {shown.map((id, i) => (
                <Glyph
                  key={`${id}-${i}`}
                  id={id}
                  weight="heavy"
                  tone="lit"
                  className="size-9 text-glow"
                />
              ))}
            </div>
            <p className="mt-4 font-mono text-[11px] text-faint">
              {raw.toUpperCase().slice(0, MAX)}
              {letters.length > MAX ? "…" : ""}
            </p>
          </>
        )}
      </div>

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        {Object.keys(GLYPHS).length} forms, all inline SVG — there is no font file behind
        this and no image sprite. If a letter is missing from your keyboard,{" "}
        <code className="font-mono text-dim">!</code> and <code className="font-mono text-dim">?</code>{" "}
        always work.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function FinaleSection() {
  const { woke } = useAlphabetWake();

  return (
    <section className="relative overflow-hidden border-t border-line py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/8 blur-[130px]"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <FadeUp>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
              Where to start
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Stop re-explaining your codebase.
            </h2>
            <p className="mt-4 max-w-lg text-pretty leading-relaxed text-dim">
              Clone it, run one session, and come back tomorrow with memory that already
              knows what you told it. Nothing to sign up for. If it is not useful, you have
              lost an afternoon and gained a very opinionated terminal agent.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#quickstart"
                className="inline-flex items-center gap-2 rounded-md bg-glow px-5 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-glow-soft"
              >
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-md border border-line px-5 py-2.5 text-sm text-dim transition-colors hover:border-line-bright hover:text-ink"
              >
                Star on GitHub
              </a>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="px-1 text-sm text-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Read the docs
              </a>
            </div>

            {/* the Konami payoff, announced politely rather than shouted */}
            <p
              role="status"
              aria-live="polite"
              className={`mt-8 font-mono text-[11px] text-glow transition-opacity duration-500 ${
                woke ? "opacity-100" : "h-0 opacity-0"
              }`}
            >
              ↑↑↓↓←→←→ba — the alphabet woke up. nice taste in easter eggs.
            </p>
          </FadeUp>

          <FadeUp delay={0.08}>
            <Spellbox />
          </FadeUp>
        </div>
      </div>
    </section>
  );
}