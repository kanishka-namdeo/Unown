import { ArrowRight } from "lucide-react";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { InstallPanel } from "./install-panel";
import { SessionReplay } from "./session-replay";
import { CopyButton, GhostLink, PrimaryLink, GITHUB_URL, DOCS_URL } from "./shell";
import { StarCount } from "./star-count";

/**
 * The prompt a visitor can hand the coding agent they already use, so the
 * agent performs the install (the pattern ollama.com/download ships in 2026).
 * It is an instruction, not a claim — every command in it is the real
 * documented install path.
 */
const AGENT_PROMPT =
  "Install the open-source coding agent Unown for me: clone " +
  "https://github.com/kanishka-namdeo/Unown, run `bun run agent:install` " +
  "inside the clone, then run `unown setup` to connect a model and " +
  "`bun run agent:start` to boot the engine. Finish by reporting what `unown doctor` says.";

const WORD: GlyphId[] = ["U", "N", "O", "W", "N"];

/* ------------------------------------------------------------------ */
/* the quickstart, absorbed from its own section (2026-10-20)          */
/* ------------------------------------------------------------------ */

/**
 * The command-by-command install sequence. Byte-identical to the README
 * quickstart and docs/install.md — the hero's one-liner chip is the fast
 * path, this is the manual one, and it lives collapsed behind the chip so
 * the fast path stays the default.
 */
const INSTALL = [
  "git clone https://github.com/kanishka-namdeo/Unown.git",
  "cd Unown",
  "bun run agent:install     # deps + pi build + .env",
  "unown setup               # connect any model",
  "bun run agent:start       # engine :3030 + bridge :3031 + dashboard :3000",
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
  ["unown automations create --cron '0 9 * * 1-5' --title 'brief'", "scheduled unattended runs — read-only by default"],
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
  "bun ≥ 1.2 · an endpoint (any OpenAI-compatible base URL + key; background " +
  "learning can also run on a local llama.cpp or Ollama lane, keyless and " +
  "offline) · Windows, macOS or Linux — same commands. OS sandbox: bubblewrap " +
  "(Linux), Seatbelt (macOS); native Windows runs the in-process jail.";

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
    <section data-hue="psychic" className="relative overflow-hidden pt-14 pb-16 sm:pt-20 sm:pb-24">
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
            <p className="gb-label text-[10px] text-gold">
              Open-source AI coding agent · built on pi
            </p>

            <h1 className="mt-5 font-display text-balance text-[2.75rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.25rem]">
              It reads what you write down.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-dim">
              Unown is a coding agent that runs in your terminal and{" "}
              <span className="text-ink">remembers</span>. Every session ends by handing a
              background engine a note. Overnight that engine turns notes into project
              memory, and refuses to keep any of it until a fresh sandbox has proven it
              twice.
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
                installer, which bootstraps bun itself; Windows gets the clone
                path, since a fresh Windows box has no sh), and the chain that
                follows either command. The tabbed panel is a client island so
                the chip stays server-rendered around it. The full
                command-by-command sequence is the expander below. */}
            <div id="quickstart" className="scroll-mt-24">
              <InstallPanel />
            </div>

            {/* the delegation path: your agent installs Unown */}
            <details className="group mt-3 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">or</span>
                have your agent install it
                <span
                  aria-hidden="true"
                  className="ml-auto text-[9px] text-faint transition-transform group-open:rotate-90"
                >
                  {'\u25B8'}
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
            <details className="group mt-3 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">manual</span>
                Clone it, point it at a model, run it.
                <span
                  aria-hidden="true"
                  className="ml-auto text-[9px] text-faint transition-transform group-open:rotate-90"
                >
                  {'\u25B8'}
                </span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <div
                  aria-label="terminal — quickstart commands"
                  className="term-lines font-mono text-[12px] leading-relaxed"
                >
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
                <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-faint">
                  {PREREQS}
                </p>
              </div>
            </details>

            {/* the command surface, still collapsed: the flagship commands
                (gated against cli.ts HELP by landing_claims.mjs) and the
                session tools every session ships. */}
            <details className="group mt-3 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">cli</span>
                the whole command surface
                <span
                  aria-hidden="true"
                  className="ml-auto text-[9px] text-faint transition-transform group-open:rotate-90"
                >
                  {'\u25B8'}
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
                  Every session also ships session tools:{" "}
                  <code className="font-mono text-dim">todo</code>,{" "}
                  <code className="font-mono text-dim">note</code>,{" "}
                  <code className="font-mono text-dim">task</code> (subagents with a fresh
                  context — typed replies via{" "}
                  <code className="font-mono text-dim">output_schema</code> and per-child git
                  worktree isolation via{" "}
                  <code className="font-mono text-dim">worktree_isolation</code>),{" "}
                  <code className="font-mono text-dim">web_search</code> +{" "}
                  <code className="font-mono text-dim">webfetch</code> (native web access —
                  keyless providers work out of the box, 19 total),{" "}
                  <code className="font-mono text-dim">fetch_url</code> and{" "}
                  <code className="font-mono text-dim">lsp</code> (language-server
                  intelligence — diagnostics ride every edit). MCP servers configured in{" "}
                  <code className="font-mono text-dim">.unown/mcp.json</code> join as{" "}
                  <code className="font-mono text-dim">mcp__server__tool</code>. Slash
                  commands: <code className="font-mono text-dim">/plan</code>,{" "}
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
                  <span className="size-1 rounded-full bg-gold/70" aria-hidden="true" />
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
            a real session: the memory banner, hook log line and note template are the
            formats Unown actually writes
          </p>
        </div>
      </div>
    </section>
  );
}
