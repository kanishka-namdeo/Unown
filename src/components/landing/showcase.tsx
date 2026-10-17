"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrowserFrame, FadeUp, SectionHead } from "./shell";

/** The seven tabs, and what each one is actually for. */
const TABS: [string, string][] = [
  ["Overview", "pass rate, shipped improvements, dream count, memory version, hook decisions, token usage"],
  ["Learning Lab", "every harness cycle: baseline → diagnosis → patch → candidate → ship or reject, with transcripts"],
  ["Memory", "the four tiers, full version history, one-click rollback — plus minted skills"],
  ["Dreams", "AutoDream sessions: merged, pruned and added notes, and the memory they produced"],
  ["Hooks", "the decision log of every guardrail: allow, deny, augment"],
  ["Console", "drive the sandboxed agent live and watch the transcript stream"],
  ["Router", "the seven background jobs: enable, disable, trigger manually, next fire time"],
];

export function ShowcaseSection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="Mission control"
            lead={
              <>
                Everything the engine does is streamed over SSE into a dashboard — every run,
                every dream, every memory version, every guardrail decision. Seven tabs, and
                none of them are decorative.
              </>
            }
          >
            A self-improving agent you cannot watch is a rumour.
          </SectionHead>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-10">
            <div>
              <BrowserFrame
                url="localhost:3000/dashboard"
                src="/landing/dash-overview.png"
                alt="Unown mission-control dashboard — Overview tab with pass rate, shipped improvements, dream count and live activity"
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <BrowserFrame
                  url="/dashboard · Learning Lab"
                  src="/landing/dash-learning-lab.png"
                  alt="Learning Lab — harness cycles, proposed memory patches and run transcripts"
                />
                <BrowserFrame
                  url="/dashboard · Hooks"
                  src="/landing/dash-hooks.png"
                  alt="Hooks — the six guardrail layers and the decision log"
                />
              </div>
              <p className="mt-3 text-[11px] text-faint">
                Captured from a live instance with real engine data — runs, dreams, notes
                and hook decisions.
              </p>
            </div>

            <div>
              <ul className="border-t border-line">
                {TABS.map(([tab, what], i) => (
                  <FadeUp
                    key={tab}
                    as="li"
                    delay={Math.min(i, 4) * 0.04}
                    className="border-b border-line py-3.5"
                  >
                    <p className="text-[13.5px] font-medium text-ink">{tab}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-dim">{what}</p>
                  </FadeUp>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="mt-6 inline-flex items-center gap-2 text-sm text-glow underline-offset-4 hover:underline"
              >
                Open the dashboard
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                Needs the engine on{" "}
                <span className="font-mono">:3030</span> — start it with{" "}
                <span className="font-mono">bun run agent:start</span>. Every tab works
                read-only until you spend tokens on a button.
              </p>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}