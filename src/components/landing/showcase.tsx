"use client";

import { ArrowRight } from "lucide-react";
import {
  ADDONS,
  ADDON_KEY_COUNT,
  ADDONS_SURFACE_RECEIPTS,
} from "./addons-data";
import { BrowserFrame, FadeUp, SectionHead } from "./shell";

/**
 * Mission control — what the running engine looks like. Compressed 2026-10-20:
 * two screenshots instead of three (the Hooks tab's story is told by the hook
 * log in the Integrity pane), and the ten-tab index became a tile row in the
 * models-band shape. The ten tabs each drive something real — the index
 * names them without pretending each needs a paragraph.
 *
 * The addons strip (below the grid, added with the TUI addon framework) is
 * the terminal's share of the same claim: the three addons and their
 * one-file config surface. The pitches and the derived key count live in
 * addons-data.ts; `__tests__/addons.test.tsx` drift-gates that data against
 * pi-repo's addons/config.ts. The tiles reuse the ten-tab row's grammar
 * (same panels, same hover) with one line of pitch instead of a two-word
 * gloss — the dex owns the creatures' capability copy, this strip owns the
 * addon framework's, and neither restates the other.
 */
const TABS: [string, string][] = [
  ["Overview", "pass rate, dreams, memory version"],
  ["Learning Lab", "harness cycles, transcripts"],
  ["Memory", "four tiers, one-click rollback"],
  ["Dreams", "AutoDream sessions"],
  ["Hooks", "every allow, deny, augment"],
  ["Console", "drive the sandboxed agent live"],
  ["Sandboxes", "isolated workspaces"],
  ["Gateway", "tokens, latency, per-model"],
  ["Router", "the seven background jobs"],
  ["Automations", "scheduled recurring runs"],
];

export function ShowcaseSection() {
  return (
    <section data-hue="gold" id="showcase" className="scroll-mt-16 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="Mission control">
            What the running engine looks like.
          </SectionHead>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
            <div>
              <BrowserFrame
                url="localhost:3000/dashboard"
                src="/landing/dash-overview.png"
                alt="Unown mission-control dashboard — Overview tab with pass rate, shipped improvements, dream count and live activity"
              />
              <div className="mt-4">
                <BrowserFrame
                  url="/dashboard · Learning Lab"
                  src="/landing/dash-learning-lab.png"
                  alt="Learning Lab — harness cycles, proposed memory patches and run transcripts"
                />
              </div>
              <p className="mt-3 text-[11px] text-faint">
                Captured from a live instance with real engine data — runs, dreams, notes
                and hook decisions, streamed over SSE. Every tab works read-only until
                you spend tokens on a button (needs the engine on{" "}
                <span className="font-mono">:3030</span>,{" "}
                <span className="font-mono">bun run agent:start</span>).
              </p>
            </div>

            <div>
              <p className="gb-label text-[9px] text-gold">
                Ten tabs · each drives something real
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-2">
                {TABS.map(([tab, what]) => (
                  <li
                    key={tab}
                    className="gb-panel lift flex h-11 items-center gap-2.5 px-3 hover:border-line-bright"
                  >
                    <span className="min-w-0">
                      <span className="block truncate gb-label text-[9px] leading-tight text-ink">
                        {tab}
                      </span>
                      <span className="block truncate font-mono text-[9px] leading-tight text-dim">
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
                Install it and open the dashboard
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </FadeUp>

        {/* The terminal's configurable side. The dashboard above is the web
            face of the running engine; the three TUI addons are its terminal
            face, and every knob on them is user config. A native disclosure
            (the budget contract's sanctioned move — the strip pays for its own
            height): the summary row carries the label + the derived key count,
            the body keeps every tile and receipt, and the whole strip stays in
            the server-rendered DOM for crawlers and gates alike (the proof
            band's pane contract). */}
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
                  The knobs range from the todo panel&apos;s line budget and the
                  advisor&apos;s review cadence to the tool descriptions the
                  model reads. Native TypeScript over pi-tui with no native
                  modules, so the same dialogs run on Windows, macOS and Linux.
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
