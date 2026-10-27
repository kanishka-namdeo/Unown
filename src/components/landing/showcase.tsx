"use client";

import { ArrowRight } from "lucide-react";
import {
  ADDONS,
  ADDON_KEY_COUNT,
  ADDONS_SURFACE_RECEIPTS,
} from "./addons-data";
import { FadeUp, SectionHead, TerminalWindow } from "./shell";

/**
 * Mission control — what the running engine looks like, in the terminal
 * (D7: the web dashboard is retired; this is the TUI's showcase). The
 * stills are real `unown dashboard` PTY captures (public/landing/tui/
 * dashboard/stills/ — pane-audited, VLM-critiqued; the capture lane is
 * scripts/tui-capture/). The eleven-screen index became a tile row in the
 * models-band shape; the screens each drive something real — the index
 * names them without pretending each needs a paragraph.
 *
 * The addons strip (below the grid) is the terminal's configurable side of
 * the same claim: the three addons and their one-file config surface. The
 * pitches and the derived key count live in addons-data.ts; `__tests__/
 * addons.test.tsx` drift-gates that data against pi-repo's addons/config.ts.
 */
const SCREENS: [string, string][] = [
  ["Overview", "pass rate, dreams, memory version"],
  ["Memory", "four tiers, one-key rollback"],
  ["Dreams", "AutoDream sessions"],
  ["Notes", "the raw learning material"],
  ["Skills", "what the agent shipped itself"],
  ["Learning Lab", "harness cycles, transcripts"],
  ["Hooks", "every allow, deny, augment"],
  ["Router", "the background jobs"],
  ["Gateway", "tokens, latency, per-model"],
  ["Routines", "scheduled recurring runs — cron, every, after"],
  ["Web Cache", "the persistent web results store"],
  ["Embedded", "/dashboard inside a live session"],
];

export function ShowcaseSection() {
  return (
    <section data-hue="gold" id="showcase" className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="Mission control">
            What the running engine looks like.
          </SectionHead>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
            <div>
              <TerminalWindow title="unown dashboard — overview">
                <figure className="m-0">
                  <img
                    src="/landing/tui/dashboard/stills/01-overview.png"
                    alt="unown dashboard — the Overview screen with pass rate, shipped improvements, dream count and the live activity rail"
                    width={1792}
                    height={1008}
                    loading="lazy"
                    className="w-full"
                  />
                  <figcaption className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-faint">
                    Overview: KPI band, task table, live activity rail.
                  </figcaption>
                </figure>
              </TerminalWindow>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TerminalWindow title="unown dashboard — memory">
                  <figure className="m-0">
                    <img
                      src="/landing/tui/dashboard/stills/02-memory.png"
                      alt="unown dashboard — the Memory screen with the four engine tiers, per-project memories, injection budget and version history"
                      width={1792}
                      height={1008}
                      loading="lazy"
                      className="w-full"
                    />
                    <figcaption className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-faint">
                      Memory: tiers, budget meter, provenance.
                    </figcaption>
                  </figure>
                </TerminalWindow>
                <TerminalWindow title="unown — session + /dashboard">
                  <figure className="m-0">
                    <img
                      src="/landing/tui/dashboard/stills/12-embedded-mount.png"
                      alt="The embedded /dashboard mount inside a live unown session — the same screens, Esc-Esc returns to the editor"
                      width={1792}
                      height={1008}
                      loading="lazy"
                      className="w-full"
                    />
                    <figcaption className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-faint">
                      Embedded: <span className="font-mono">/dashboard</span> inside a live session.
                    </figcaption>
                  </figure>
                </TerminalWindow>
              </div>
              <p className="mt-3 text-[11px] text-faint">
                Real <span className="font-mono">unown dashboard</span> stills,
                streamed over SSE from <span className="font-mono">:3030</span>{" "}
                ({" "}
                <span className="font-mono">bun run agent:start</span>, then{" "}
                <span className="font-mono">unown dashboard</span>).
              </p>
            </div>

            <div>
              <p className="gb-label text-[9px] text-gold">
                Twelve surfaces · each drives something real
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-2">
                {SCREENS.map(([screen, what]) => (
                  <li
                    key={screen}
                    className="gb-panel lift flex min-h-11 items-center gap-2.5 px-3 py-1.5 hover:border-line-bright"
                  >
                    <span className="min-w-0">
                      <span className="block truncate gb-label text-[9px] leading-tight text-ink">
                        {screen}
                      </span>
                      {/* wraps instead of truncates: "scheduled recurring
                          runs — cron, every, after" lost 76px behind an
                          ellipsis at 390px, which on a screen-name index
                          reads as broken rather than concise */}
                      <span className="mt-0.5 block font-mono text-[9px] leading-tight text-dim">
                        {what}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <a
                href="#quickstart"
                className="mt-6 inline-flex items-center gap-2 text-sm text-gold underline-offset-4 hover:underline"
              >
                Install it and run unown dashboard
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </FadeUp>

        {/* The terminal's configurable side. The dashboard above is the
            terminal face of the running engine; the three TUI addons are its
            configurable face, and every knob on them is user config. A native
            disclosure (the budget contract's sanctioned move — the strip pays
            for its own height): the summary row carries the label + the
            derived key count, the body keeps every tile and receipt, and the
            whole strip stays in the server-rendered DOM for crawlers and
            gates alike (the proof band's pane contract). */}
        <FadeUp delay={0.12} className="mt-6 border-t border-line pt-4">
          <details className="group/addons">
            <summary className="flex cursor-pointer select-none list-none items-baseline justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="gb-label block text-[9px] text-gold">
                  Three TUI addons · every setting is user config
                </span>
                <span className="mt-1.5 block text-[12.5px] leading-relaxed text-dim">
                  One file holds every setting,{" "}
                  <span className="font-mono">~/.unown/agent/addons.json</span>: {ADDON_KEY_COUNT}{" "}
                  user-tunable keys across the three —{" "}
                  <span className="font-mono">/addons</span> is the live
                  configurator.
                </span>
              </span>
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 font-mono text-[13px] leading-none text-faint transition-transform duration-200 group-open/addons:rotate-45 [transition-timing-function:steps(2,end)]"
              >
                +
              </span>
            </summary>
            <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
              <div className="min-w-0">
                <p className="text-[12.5px] leading-relaxed text-dim">
                  The knobs range from the todo panel&apos;s line budget to the
                  tool descriptions the model reads. Native TypeScript over
                  pi-tui with no native modules, so the same dialogs run on
                  Windows, macOS and Linux.
                </p>
                <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
                  <span className="text-faint">receipts:</span>
                  {ADDONS_SURFACE_RECEIPTS.map(([label, href]) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-faint underline underline-offset-2 transition-colors hover:text-gold"
                    >
                      {label}
                    </a>
                  ))}
                </p>
              </div>

              <ul
                aria-label="the three TUI addons"
                className="grid gap-2 sm:grid-cols-3"
              >
                {ADDONS.map((a) => (
                  <li
                    key={a.name}
                    className="gb-panel lift flex flex-col p-3.5 hover:border-line-bright"
                  >
                    <span className="font-mono text-[11.5px] text-ink">
                      {a.name}
                    </span>
                    <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-dim">
                      {a.pitch}
                    </p>
                    <a
                      href={a.receipt[1]}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-3 font-mono text-[10px] text-faint underline underline-offset-2 transition-colors hover:text-gold"
                    >
                      {a.receipt[0]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </FadeUp>
      </div>
    </section>
  );
}
