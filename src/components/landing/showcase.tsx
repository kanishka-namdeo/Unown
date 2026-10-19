"use client";

import { ArrowRight } from "lucide-react";
import { BrowserFrame, FadeUp, SectionHead } from "./shell";

/**
 * Mission control — what the running engine looks like. Compressed 2026-10-20:
 * two screenshots instead of three (the Hooks tab's story is told by the hook
 * log in the Integrity pane), and the ten-tab index became a tile row in the
 * models-band shape. The ten tabs each drive something real — the index
 * names them without pretending each needs a paragraph.
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
    <section data-hue="gold" id="showcase" className="scroll-mt-16 py-16 sm:py-20">
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
      </div>
    </section>
  );
}
