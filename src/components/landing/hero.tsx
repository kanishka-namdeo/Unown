import { ArrowRight } from "lucide-react";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { SessionReplay } from "./session-replay";
import { CopyButton, GhostLink, PrimaryLink, GITHUB_URL, DOCS_URL } from "./shell";
import { StarCount } from "./star-count";

const INSTALL = [
  "git clone https://github.com/kanishka-namdeo/Unown.git",
  "cd Unown && bun run agent:install",
  "unown setup --provider dashscope --api-key sk-…",
  "unown",
].join("\n");

const WORD: GlyphId[] = ["U", "N", "O", "W", "N"];

/* ------------------------------------------------------------------ */
/* the seal                                                            */
/* ------------------------------------------------------------------ */

/**
 * UNOWN spelled in the script, stacked.
 *
 * Each form is bound to a slice of the hero's scroll timeline in
 * `landing.css`, so the word assembles itself as you read down the page — and a
 * visitor who never scrolls still sees all five, just quietly. Browsers without
 * scroll-driven animations get the finished word, because the base state is the
 * finished state.
 *
 * The border behind it is deliberate: Unown is an engraving stuck to a wall in
 * the ruins, so the mark is presented as something carved rather than floating.
 */
function Seal() {
  return (
    <div className="seal-stage relative flex flex-col items-center">
      <div
        aria-hidden="true"
        className="absolute -inset-x-10 -inset-y-12 rounded-xl border border-line/70 bg-panel/40"
      />

      <div className="relative flex flex-col items-center gap-2 sm:gap-2.5">
        {WORD.map((id, i) => (
          <span
            key={`${id}-${i}`}
            className="seal-form relative block size-[4.5rem] text-ink sm:size-20"
            aria-hidden="true"
          >
            {/* The halo wraps only the first form so the glow reads as a single
                light source rather than five. */}
            {i === 0 ? (
              <span
                className="seal-halo pointer-events-none absolute left-1/2 top-1/2 size-48 -z-10 rounded-full bg-emerald-500/20 blur-3xl"
                aria-hidden="true"
              />
            ) : null}
            <Glyph id={id} weight="heavy" tone="lit" className="size-full text-ink" />
          </span>
        ))}
      </div>

      <div className="relative mt-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          National № 0201
        </p>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          Symbol · Psychic
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.1em] text-dim">アンノーン</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* trust strip                                                         */
/* ------------------------------------------------------------------ */

/**
 * Sits directly under the copy rather than below the fold. Research on dev-tool
 * landing pages is consistent that a trust block immediately after the hero is
 * what converts: it answers "is this real" before the visitor has to ask.
 */
const TRUST = [
  "MIT licensed",
  "no telemetry, no account",
  "runs on your machine",
  "any OpenAI-compatible model",
  "OS-level sandbox",
  "receipts in the repo",
];

/* ------------------------------------------------------------------ */
/* hero                                                                */
/* ------------------------------------------------------------------ */

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-14 pb-16 sm:pt-20 sm:pb-24">
      {/* one warm glow, top-left, following the left edge of the copy */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 -top-52 size-[560px] rounded-full bg-emerald-500/8 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(120,113,104,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,113,104,0.10)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_70%_55%_at_30%_0%,black_10%,transparent_78%)]"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          {/* copy */}
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
              Open source · MIT · built on the pi agent
            </p>

            <h1 className="mt-5 text-balance text-[2.75rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.25rem]">
              It reads what you write down.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-dim">
              Unown is a coding agent that runs in your terminal and{" "}
              <span className="text-ink">remembers</span>. Every session ends by handing
              the engine a note. Overnight the engine turns notes into project memory —
              and refuses to keep any of it until a fresh sandbox has proven it twice.
            </p>

            <p className="mt-6 max-w-xl border-l border-line pl-4 font-mono text-[11.5px] leading-relaxed text-faint">
              self-improving terminal coding agent
              <br />
              tiered memory · AutoDreaming · sandbox-verified harness
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryLink href="#quickstart">
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </PrimaryLink>
              <GhostLink href={GITHUB_URL} external>
                Star on GitHub
                <span className="ml-1 font-mono text-[11px] text-faint tabular-nums">
                  <StarCount />
                </span>
              </GhostLink>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="link-sweep px-1 text-sm text-dim transition-colors hover:text-ink"
              >
                Read the docs
              </a>
            </div>

            {/* Install. For a clone-and-run tool the command is the conversion,
                so it sits above the fold rather than at the bottom of the page. */}
            <div className="mt-8 max-w-xl overflow-hidden rounded-md border border-line bg-panel/70">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  five minutes to a smarter terminal
                </span>
                <CopyButton text={INSTALL} label="Copy the install commands" />
              </div>
              <pre className="term-lines overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
                {INSTALL}
              </pre>
            </div>

            {/* trust, still above the fold */}
            <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2">
              {TRUST.map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2 font-mono text-[11px] text-faint"
                >
                  <span className="size-1 rounded-full bg-glow/70" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <Seal />
        </div>

        {/* the product itself */}
        <div className="rise mt-16 sm:mt-24">
          <SessionReplay />
          <p className="mt-3 text-center font-mono text-[11px] text-faint">
            a real session — the memory banner, hook log line and note template are the
            formats Unown actually writes
          </p>
        </div>
      </div>
    </section>
  );
}