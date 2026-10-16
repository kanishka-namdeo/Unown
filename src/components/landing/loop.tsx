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
  caption: string;
  title: string;
  lead: string;
  filename: string;
  body: string;
  caption2: string;
};

/**
 * Every `body` below is the literal format the engine writes, not a paraphrase:
 * the note template from `termhooks.ts`, the log strings from `harness.ts`, and
 * real AutoDream-authored lines from this repository's project memory. Showing
 * the formats is the whole argument — a diagram of the idea proves nothing.
 */
const BEATS: Beat[] = [
  {
    key: "work",
    glyph: "W",
    label: "Work",
    caption: "you chat",
    title: "The session ends by writing something down.",
    lead: "Every terminal session is captured on the way out as a note in a fixed template, delivered to the engine. If the engine is down the note waits in an outbox and syncs when it comes back — so the learning loop never depends on the loop being up.",
    filename: "~/.unown/notes/outbox/1757...-checkout.md",
    body: [
      "Terminal session in ~/code/checkout (3 min): 1 prompt(s),",
      "14 tool call(s) (read, grep, edit, bash).",
      "Final outcome: all 14 checkout specs green.",
      "",
      "If the session hit failures or discovered project-specific",
      "pitfalls, record them as concise imperative rules; otherwise",
      "record any durable project conventions worth remembering.",
    ].join("\n"),
    caption2:
      "The literal note template. A subagent session gets a [subagent] tag in the same line, so the engine can tell where a note came from.",
  },
  {
    key: "learn",
    glyph: "L",
    label: "Learn",
    caption: "it mines",
    title: "A patch has to pass twice to be allowed to exist.",
    lead: "The harness runs the suite in a fresh sandbox. If it fails, the transcript is mined for memory rules that would have prevented it, and a candidate re-runs against the patched memory. One passing run is a lucky run; the second run is the gate.",
    filename: "engine log - harness.ts",
    body: [
      "baseline      failed    impl-map-limit - 0/1 verification",
      "diagnosis     loop drops the trailing window edge; flushes lazily",
      "candidate     passed",
      "confirmation  failed    patch NOT shipped (noise gate)",
      "  ...",
      "baseline      failed    impl-map-limit - 0/1 verification",
      "diagnosis     loop drops the trailing window edge; flushes lazily",
      "candidate     passed",
      "confirmation  passed",
      "",
      "              candidate + confirmation both passed - patch",
      "              shipped to project memory (v7)",
    ].join("\n"),
    caption2:
      "Real log strings, in the order the engine emits them. A patch that regresses later gets un-shipped by the retention check.",
  },
  {
    key: "dream",
    glyph: "D",
    label: "Dream",
    caption: "it dreams",
    title: "Then the notes become a file you can read.",
    lead: "AutoDream merges duplicates, drops stale observations and reorganises into topic sections. Its prompt tells it to never delete hard-won rules and to keep the file under 120 lines. A canary run gates the whole thing, and rolls it back if the last-passing task stops passing.",
    filename: ".unown/memory/project.md",
    body: [
      "# Tier 1 - Project Memory",
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
      "- Failed cycles auto-recover - do NOT restart engine to",
      "  fix them.",
    ].join("\n"),
    caption2:
      "Real lines from this repository's project memory, written by AutoDream. If a dream breaks the last-passing task, the log reads: rolled back to v5: canary task failed under the new memory.",
  },
];

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
            Three steps, run continuously by the engine while you work. What follows is
            not a diagram of the idea — it is the formats each step actually writes.
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          {/* horizontal tabs: a different rhythm from every other two-column
              section on the page, and it gives the artifact full width */}
          <div
            role="tablist"
            aria-label="Stages of the learning loop"
            onKeyDown={onKeyDown}
            className="grid gap-px overflow-hidden rounded-t-lg border border-b-0 border-line bg-line sm:grid-cols-3"
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
                  className={`group relative flex items-center gap-3.5 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-glow ${
                    on ? "bg-panel-2" : "bg-panel hover:bg-panel-2"
                  }`}
                >
                  {/* the active marker is a bar, not a colour change: colour
                      alone fails 1.4.1 and this reads faster too */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 top-0 h-0.5 origin-left transition-transform duration-300 ${
                      on ? "scale-x-100 bg-glow" : "scale-x-0 bg-glow"
                    }`}
                  />
                  <Glyph
                    id={b.glyph}
                    weight="heavy"
                    tone={on ? "lit" : "dim"}
                    className={`size-7 shrink-0 transition-colors ${
                      on ? "text-glow" : "text-faint group-hover:text-dim"
                    }`}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-[15px] ${on ? "text-ink" : "text-dim"}`}
                    >
                      {b.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      {b.caption}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`loop-panel-${beat.key}`}
            aria-labelledby={`loop-tab-${beat.key}`}
            tabIndex={0}
            className="rounded-b-lg border border-line bg-panel/40 p-6 focus:outline-none sm:p-8"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={beat.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
                  <div>
                    <h3 className="text-balance text-xl font-medium text-ink sm:text-2xl">
                      {beat.title}
                    </h3>
                    <p className="mt-4 text-pretty text-[13.5px] leading-relaxed text-dim">
                      {beat.lead}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <div className="overflow-hidden rounded-lg border border-line">
                      <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2">
                        <span
                          className="size-1.5 rounded-full bg-glow/60"
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-[10.5px] text-faint">
                          {beat.filename}
                        </span>
                      </div>
                      <pre className="term-lines overflow-x-auto px-4 py-4 font-mono text-[11px] leading-relaxed text-dim sm:text-[11.5px]">
                        {beat.body}
                      </pre>
                    </div>
                    <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                      {beat.caption2}
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}