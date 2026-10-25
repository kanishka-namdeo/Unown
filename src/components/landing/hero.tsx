import { ArrowRight } from "lucide-react";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { InstallPanel } from "./install-panel";
import { SessionReplay } from "./session-replay";
import { CopyButton, GhostLink, PixelCursor, PrimaryLink, GITHUB_URL, DOCS_URL, BetaBadge } from "./shell";
import { StarCount } from "./star-count";

/**
 * The prompt a visitor can hand the coding agent they already use, so the
 * agent performs the install (the pattern ollama.com/download ships in 2026).
 * It is an instruction, not a claim — every command in it is the real
 * documented install path.
 */
const AGENT_PROMPT =
  "Install the open-source coding agent Unown for me with the full stack: clone " +
  "https://github.com/kanishka-namdeo/Unown, run `bun run agent:install` " +
  "inside the clone, then run `unown setup` to connect a model and " +
  "`bun run agent:start` to boot the engine. Finish by reporting what `unown doctor` says.";

const WORD: GlyphId[] = ["U", "N", "O", "W", "N"];

/* ------------------------------------------------------------------ */
/* the quickstart, absorbed from its own section (2026-10-20)          */
/* ------------------------------------------------------------------ */

/**
 * The command-by-command full-stack install sequence. Mirrors the README
 * quickstart and docs/install.md's manual section — the hero's one-liner chip
 * is the CLI-only binary fast path; this is the source lane that adds the
 * engine, llm-bridge and learning stack, collapsed behind the chip.
 */
const INSTALL = [
  "git clone https://github.com/kanishka-namdeo/Unown.git",
  "cd Unown",
  "bun run agent:install     # deps + pi build + .env",
  "unown setup               # connect any model",
  "bun run agent:start       # engine :3030 + bridge :3031",
  "unown                     # first session — notes queue for the engine",
];

/**
 * The command surface. Each row is gated by `scripts/landing_claims.mjs`
 * against the HELP block in `cli.ts` — a command the CLI does not ship turns
 * the page red. The gate is one-directional (page → source): this list names
 * the flagship commands, HELP remains the superset.
 */
const COMMANDS: [string, string][] = [
  ["unown", "interactive session in the current project"],
  ['unown "fix the failing tests"', "start with a prompt"],
  ['unown -p "explain the build error"', "one-shot headless, pipes to less"],
  ['unown --plan "add auth"', "read-only plan mode, approve before executing"],
  ['unown --goal "make the build green"', "durable goal — completion needs cited evidence"],
  ["unown routines create --every '1d at 09:00' --title 'brief'", "recurring runs — cron, every, after; read-only by default"],
  ["unown setup", "provider wizard, or --provider/--api-key/--model"],
  ["unown models", "configured models plus what the bridge serves"],
  ["unown doctor", "endpoint, keys, upstream and memory, end to end"],
  ["unown memory", "print the effective four-tier stack"],
  ["unown init", "scaffold this project's .unown/memory files"],
  ["unown mcp add playwright npx @playwright/mcp@latest", "connect any MCP server — its tools join every session"],
  ['unown note "flaky auth spec"', "hand AutoDream a note directly"],
  ["unown update", "self-update to the newest release — check, pin, roll back"],
];

/**
 * The prerequisites, one line: the runtime version floor, the endpoint
 * requirement (incl. the local lane), and the three-OS sandbox ladder.
 */
const PREREQS =
  "Full install: bun ≥ 1.4 · any OpenAI-compatible endpoint (background " +
  "learning can also run local llama.cpp or Ollama, keyless and offline) · " +
  "Windows, macOS or Linux. Sandbox: bubblewrap (Linux), Seatbelt (macOS); " +
  "Windows runs the in-process jail.";

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
        className="absolute -inset-x-10 -inset-y-12 border border-line/70"
      />

      <div className="relative flex flex-col items-center gap-2 sm:gap-2.5">
        {WORD.map((id, i) => (
          <span
            key={`${id}-${i}`}
            className="seal-form relative block size-[4.5rem] text-ink sm:size-20"
            aria-hidden="true"
          >
            {/* The halo wraps only the first form so the gold reads as a single
                light source rather than five. */}
            {i === 0 ? (
              <span
                className="seal-halo pointer-events-none absolute left-1/2 top-1/2 size-48 -z-10 gb-dither opacity-30"
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
 * Sits directly under the copy rather than below the fold, so "is this real"
 * is answered before the visitor has to ask it. Every claim here is about the
 * *download* specifically, which no other section argues.
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
    <section data-hue="psychic" className="relative overflow-hidden pt-14 pb-16 sm:pt-16 sm:pb-20">
      {/* one warm dither halo, top-left, following the left edge of the copy */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 -top-52 size-[560px] gb-dither opacity-15"
      />
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-0"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          {/* copy — min-w-0 so this grid item can shrink below the install
              <pre>'s min-content; without it the git-clone URL sets the
              column's intrinsic width and the section clips it on phones. */}
          <div className="max-w-2xl min-w-0">
            {/* The stage, said in the same breath as the category — the badge
                the Vercel/Figma product pages carry next to their H1s. It is
                the `BetaBadge` from shell.tsx (one component, three homes:
                here, the header wordmark, the footer note), and the sentence
                under the subhead below is the plain-language half of the
                pattern: a badge states the stage, a sentence says what it
                means for the reader. */}
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <BetaBadge />
              <span className="gb-label text-[10px] text-gold">
                Open-source AI coding agent · built on pi
              </span>
            </p>

            {/* The h1 carries the search phrases ("terminal coding agent") —
                it is the strongest on-page relevance signal, and a purely
                poetic h1 wasted it. The old headline moved into the subhead
                below verbatim, so the page's voice is unchanged and the
                deploy gate's text assertion ("It reads what you write down")
                still holds. `e2e/seo.spec.ts` pins the h1's keyword line. */}
            <h1 className="mt-5 font-display text-balance text-[2.75rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.25rem]">
              The terminal coding agent that remembers.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-dim">
              It reads what you write down: every session hands a
              background engine a{" "}
              <span className="text-ink">note</span>. Overnight the notes become
              project memory — kept only after a fresh sandbox proves it twice.
            </p>

            {/* What "beta" means here, in words — the plain-language half of
                the badge pattern (Vercel's feature pages pair the badge with
                one sentence of availability copy; Raycast states it in the
                subtitle). Honest by the page's own rule: the version line is
                0.0.x, the changelog records moving formats, and issues are
                where rough edges go. */}
            <p className="mt-3 max-w-xl font-mono text-[12px] leading-relaxed text-faint">
              Unown is in beta — expect rough edges and moving formats; report what breaks.
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
                so it sits above the fold rather than at the bottom of the page:
                one copyable chip per OS tab (macOS/Linux get the one-line
                installer; Windows gets its PowerShell one-liner,
                public/install.ps1 — both install the newest stable release
                BINARY: verified download, no git, no bun), and the chain that
                follows either command. The tabbed panel is a client island so
                the chip stays server-rendered around it. The full-stack source
                sequence is the expander below. */}
            <div id="quickstart" className="scroll-mt-24">
              <InstallPanel />
            </div>

            {/* the delegation path: your agent installs Unown */}
            <details className="group mt-2 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">or</span>
                have your agent install it
                <span
                  aria-hidden="true"
                  className="ml-auto flex text-faint transition-transform group-open:rotate-90"
                >
                  {/* drawn, not a font glyph: ▸ falls outside the latin subset
                      the page's fonts are sliced to */}
                  <PixelCursor className="h-[9px] w-[7px]" />
                </span>
              </summary>
              <div className="border-t border-line px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                    paste this into the agent you already use
                  </span>
                  <CopyButton text={AGENT_PROMPT} label="Copy the agent install prompt" />
                </div>
                <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-dim">
                  {AGENT_PROMPT}
                </p>
              </div>
            </details>

            {/* the full quickstart, absorbed from its own section (2026-10-20):
                the sequence, the prerequisites and the command surface live
                collapsed behind the one-liner chip, so the fast path stays the
                default and the manual path stays one click away. */}
            <details className="group mt-2 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">source</span>
                Full install — clone, point at a model, run.
                <span
                  aria-hidden="true"
                  className="ml-auto flex text-faint transition-transform group-open:rotate-90"
                >
                  {/* drawn, not a font glyph: ▸ falls outside the latin subset
                      the page's fonts are sliced to */}
                  <PixelCursor className="h-[9px] w-[7px]" />
                </span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <div className="term-lines font-mono text-[12px] leading-relaxed">
                  {INSTALL.map((line, i) => {
                    const hash = line.indexOf("#");
                    const cmd = hash === -1 ? line : line.slice(0, hash);
                    const comment = hash === -1 ? "" : line.slice(hash);
                    return (
                      <div key={i} className="flex items-baseline gap-3 whitespace-pre">
                        <span className="gb-label shrink-0 text-[9px] text-gold">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-ink">{cmd}</span>
                        {comment ? <span className="text-faint">{comment}</span> : null}
                      </div>
                    );
                  })}
                </div>
                {/* the full-stack lane: the chip's one-liner is the CLI-only
                    binary; this sequence adds the engine, llm-bridge and
                    learning stack. The script form is the same lane, one
                    command, and is never the chip's command. */}
                <p className="mt-3 border-t border-line pt-2.5 font-mono text-[11px] leading-relaxed text-dim">
                  <span className="gb-label text-[9px] text-gold">full stack</span>{" "}
                  the chip above installs the terminal agent only; this lane adds the
                  engine, llm-bridge and learning stack. As one command:{" "}
                  <code className="break-words font-mono text-ink">
                    curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --source
                  </code>{" "}
                  (macOS/Linux) or{" "}
                  <code className="break-words font-mono text-ink">
                    irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1;
                    .\install.ps1 -Source
                  </code>{" "}
                  (Windows).
                </p>
                <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-faint">
                  {PREREQS}
                </p>
              </div>
            </details>

            {/* the command surface, still collapsed: the flagship commands
                (gated against cli.ts HELP by landing_claims.mjs) and the
                session tools every session ships. */}
            <details className="group mt-2 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">cli</span>
                the whole command surface
                <span
                  aria-hidden="true"
                  className="ml-auto flex text-faint transition-transform group-open:rotate-90"
                >
                  {/* drawn, not a font glyph: ▸ falls outside the latin subset
                      the page's fonts are sliced to */}
                  <PixelCursor className="h-[9px] w-[7px]" />
                </span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <ul>
                  {COMMANDS.map(([cmd, what]) => (
                    <li
                      key={cmd}
                      className="flex flex-col gap-1 border-b border-line py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
                    >
                      <code className="shrink-0 font-mono text-[11.5px] text-ink sm:w-64">
                        {cmd}
                      </code>
                      <span className="text-[12.5px] leading-relaxed text-dim">{what}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] leading-relaxed text-faint">
                  Every session also ships session tools —{" "}
                  <code className="font-mono text-dim">todo</code>,{" "}
                  <code className="font-mono text-dim">note</code>,{" "}
                  <code className="font-mono text-dim">task</code>,{" "}
                  <code className="font-mono text-dim">web_search</code> +{" "}
                  <code className="font-mono text-dim">webfetch</code>,{" "}
                  <code className="font-mono text-dim">fetch_url</code> and{" "}
                  <code className="font-mono text-dim">lsp</code> — and any MCP server you
                  configure joins it. Each one is catalogued, with its capture and its
                  receipts, in{" "}
                  <a href="#dex" className="text-gold underline underline-offset-2">
                    the capability dex
                  </a>{" "}
                  below. Slash commands: <code className="font-mono text-dim">/plan</code>,{" "}
                  <code className="font-mono text-dim">/review</code>,{" "}
                  <code className="font-mono text-dim">/goal</code>,{" "}
                  <code className="font-mono text-dim">/undo</code>,{" "}
                  <code className="font-mono text-dim">/receipts</code>,{" "}
                  <code className="font-mono text-dim">/mcp</code> — plus{" "}
                  <code className="font-mono text-dim">/todos</code>,{" "}
                  <code className="font-mono text-dim">/note</code>,{" "}
                  <code className="font-mono text-dim">/agents</code>,{" "}
                  <code className="font-mono text-dim">/learning</code>,{" "}
                  <code className="font-mono text-dim">/lsp</code>.
                </p>
                <a
                  href={`${GITHUB_URL}/tree/main/docs`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-block font-mono text-[11.5px] text-gold underline-offset-4 hover:underline"
                >
                  the full usage reference
                </a>
              </div>
            </details>

            {/* trust, still above the fold */}
            <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2">
              {TRUST.map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2 font-mono text-[11px] text-faint"
                >
                  <span className="size-1 bg-gold/70" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <Seal />
        </div>

        {/* the session party moved to the capability dex (#dex) with the rest
            of the creatures, 2026-10-20 */}

        {/* the product itself */}
        <div className="rise mt-10 sm:mt-14">
          <SessionReplay />
          <p className="mt-3 text-center font-mono text-[11px] text-faint">
            a real session: the memory banner, hook log and note template are formats
            Unown writes
          </p>
        </div>
      </div>
    </section>
  );
}
