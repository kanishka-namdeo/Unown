"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { FadeUp } from "./shell";

/* ------------------------------------------------------------------ */
/* the three real artifacts                                            */
/* ------------------------------------------------------------------ */

type Beat = {
  key: string;
  glyph: GlyphId;
  label: string;
  title: string;
  lead: string;
  filename: string;
  kind: "log" | "note" | "md";
  body: string;
  caption: string;
};

const BEATS: Beat[] = [
  {
    key: "work",
    glyph: "W",
    label: "Work",
    title: "The session ends by writing something down.",
    lead: "Every terminal session is captured on the way out — a note describing what happened, in a fixed template, delivered to the engine. If the engine is down it sits in an outbox and syncs later.",
    filename: "~/.unown/notes/outbox/1757…-checkout.md",
    kind: "note",
    body: [
      "Terminal session in ~/code/checkout (3 min): 1 prompt(s),",
      "14 tool call(s) (read, grep, edit, bash).",
      "Final outcome: all 14 checkout specs green.",
      "",
      "If the session hit failures or discovered project-specific",
      "pitfalls, record them as concise imperative rules; otherwise",
      "record any durable project conventions worth remembering.",
    ].join("\n"),
    caption:
      "The literal note template from termhooks.ts — subagent sessions get a [subagent] tag so the engine can tell them apart.",
  },
  {
    key: "learn",
    glyph: "L",
    label: "Learn",
    title: "A patch has to pass twice to be allowed to exist.",
    lead: "The harness runs the suite in a fresh sandbox, mines the transcript of whatever failed, and drafts rules that would have prevented it. One passing run is a lucky run. The second run is the gate.",
    filename: "engine log — harness.ts",
    kind: "log",
    body: [
      "baseline      failed    impl-map-limit · 0/1 verification",
      "diagnosis     loop drops the trailing window edge; flushes lazily",
      "candidate     passed",
      "confirmation  failed    patch NOT shipped (noise gate)",
      "  …",
      "baseline      failed    impl-map-limit · 0/1 verification",
      "diagnosis     loop drops the trailing window edge; flushes lazily",
      "candidate     passed",
      "confirmation  passed",
      "              candidate + confirmation both passed — patch",
      "              shipped to project memory (v7)",
    ].join("\n"),
    caption:
      "Real log strings from the engine, in the order it emits them. A patch that regresses later is un-shipped automatically by the retention check.",
  },
  {
    key: "dream",
    glyph: "D",
    label: "Dream",
    title: "Then the notes get consolidated into a file you can read.",
    lead: "AutoDream merges duplicates, drops stale observations, reorganises into topic sections — and is told, in its prompt, to never delete hard-won rules and to keep the file under 120 lines. A canary run gates the whole thing.",
    filename: ".unown/memory/project.md",
    kind: "md",
    body: [
      "# Tier 1 — Project Memory",
      "",
      "## Workflow",
      "- Unown sessions have access to: todo, note, task,",
      "  fetch_url, read, ls, grep.",
      "",
      "## Engine restart procedure",
      "- Find bun --hot PID with cwd mini-services/agent-service.",
      "- bun --hot does NOT reload changes outside mini-services/.",
      "",
      "## Known pitfalls",
      "- LLM bridge calls timeout at 240s with 3 retries;",
      "  agent watchdog at 600s.",
      "- Failed cycles auto-recover — do NOT restart engine to",
      "  fix them.",
    ].join("\n"),
    caption:
      "Real lines from this repository's project memory, written by AutoDream. If a dream breaks the last-passing task: rolled back to v5: canary task failed under the new memory.",
  },
];

const TONE: Record<Beat["kind"], string> = {
  log: "text-dim",
  note: "text-dim",
  md: "text-ink",
};

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function LoopSection() {
  const [active, setActive] = React.useState(0);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const beat = BEATS[active];

  // Roving tabindex with arrow keys, per the WAI-ARIA tabs pattern.
  function onKeyDown(e: React.KeyboardEvent) {
    const last = BEATS.length - 1;
    let next = active;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="loop" className="scroll-mt-16 border-y border-line bg-panel/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
            The learning loop
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Most agents forget. This one has to prove it remembered.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-dim">
            Three steps, run continuously by the engine while you work. Here is what each
            one actually writes — not a diagram of the idea, the formats themselves.
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-10">
          <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
            {/* tabs */}
            <div
              role="tablist"
              aria-label="Stages of the learning loop"
              aria-orientation="vertical"
              onKeyDown={onKeyDown}
              className="flex gap-2 lg:flex-col lg:gap-1"
            >
              {BEATS.map((b, i) => {
                const on = i === active;
                return (
                  <button
                    key={b.key}
                    ref={(el) => {
                      tabs.current[i] = el;
                    }}
                    role="tab"
                    id={`loop-tab-${b.key}`}
                    aria-selected={on}
                    aria-controls={`loop-panel-${b.key}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => setActive(i)}
                    className={`flex flex-1 items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-glow ${
                      on
                        ? "border-glow/40 bg-glow/6"
                        : "border-transparent text-dim hover:border-line hover:text-ink"
                    }`}
                  >
                    <Glyph
                      id={b.glyph}
                      weight="heavy"
                      className={`size-6 shrink-0 ${on ? "text-glow" : "text-faint"}`}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm ${on ? "text-ink" : ""}`}>{b.label}</span>
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                        {["you chat", "it mines", "it dreams"][i]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* panel */}
            <div
              role="tabpanel"
              id={`loop-panel-${beat.key}`}
              aria-labelledby={`loop-tab-${beat.key}`}
              tabIndex={0}
              className="min-w-0 rounded-lg border border-line bg-canvas/60 p-6 focus:outline-none sm:p-8"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={beat.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <h3 className="text-balance text-xl font-medium text-ink">{beat.title}</h3>
                  <p className="mt-3 max-w-xl text-pretty text-[13.5px] leading-relaxed text-dim">
                    {beat.lead}
                  </p>

                  <div className="mt-6 overflow-hidden rounded-md border border-line">
                    <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2">
                      <span className="size-1.5 rounded-full bg-line-bright" aria-hidden="true" />
                      <span className="truncate font-mono text-[10.5px] text-faint">
                        {beat.filename}
                      </span>
                    </div>
                    <pre
                      className={`term-lines overflow-x-auto px-4 py-4 font-mono text-[11px] leading-relaxed sm:text-[11.5px] ${TONE[beat.kind]}`}
                    >
                      {beat.body}
                    </pre>
                  </div>
                  <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{beat.caption}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}