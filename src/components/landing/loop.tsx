"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { FadeUp, SectionHead, PixelCursor } from "./shell";
import { ENGINE_JOBS } from "./engine-data";

/**
 * The "how it learns" band — one section where the page used to spend three.
 *
 * Origin (the two-halves argument) and the loop (the three tabbed artifacts)
 * told one story across 1,179 words and four sub-headers; a visitor met the
 * same "notes → memory → a better session" idea four times before the
 * screenshots. The 2026-10-20 round merged them: the beats tabs stay
 * verbatim (they are the receipts — every body is the literal format the
 * engine writes, gated by `scripts/landing_claims.mjs`) and the pair strip
 * carries origin's argument in two cards. The five mechanisms + the SDLC
 * index bento lived here from 2026-10-19 to 2026-10-20; its tiles moved to
 * the capability dex (`dex.tsx`) when the creatures got their one canonical
 * home — the capability copy travels with the sprites, not duplicated.
 */

/**
 * The engine's schedule, rendered the way a cron listing reads. Generated
 * from `JOB_DEFS` in `router.ts` via `scripts/landing_claims.mjs` — CI
 * re-runs the generator, so this listing cannot name a job the engine does
 * not run.
 */
const JOB_LINES = (() => {
  const timers = ENGINE_JOBS.filter((j) => j.kind === "interval");
  const events = ENGINE_JOBS.filter((j) => j.kind === "event");
  const width = Math.max(0, ...timers.map((j) => j.id.length)) + 6;
  return [
    ...timers.map((j) => `${j.id}${(j.interval ?? "").padStart(width - j.id.length)}`),
    ...events.map((j) => `on ${j.event}`),
  ];
})();

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
      "Terminal session outcome in ~/code/checkout:",
      "Final outcome: all 14 checkout specs green.",
      "",
      "Session metadata (never extractable — counts and duration only): 1 prompt(s),",
      "14 tool call(s) (read, grep, edit, bash), 3 min.",
    ].join("\n"),
    caption2:
      "The literal note template — outcome first (that is the knowledge), counts and duration demoted to a labeled metadata line. A subagent session gets a [subagent] tag in the same header, so the engine can tell where a note came from.",
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
      "candidate run 41d0c9a2 failed — looping back",
      "",
      "candidate run 7ba3f1e0 passed but confirmation 2d5e9b77 did",
      "not — patch NOT shipped (noise gate)",
      "  ...",
      "candidate 8f21c0a3 + confirmation both passed — patch shipped",
      "to project memory (v7)",
    ].join("\n"),
    caption2:
      "Three real log lines from `harness.ts`, in the order the engine emits them — the failed loop-back, the noise-gate refusal, the ship. A patch that regresses later gets un-shipped by the retention check.",
  },
  {
    key: "dream",
    glyph: "D",
    label: "Dream",
    caption: "it dreams",
    title: "Then the notes become a file you can read.",
    lead: "AutoDream extracts atomic memories through the Mem0 learning core, reconciles them — newest evidence wins, hard-won verified rules are preserved — and renders the scope into topic sections with a provenance footer. A canary run gates the whole thing, and rolls it back if the last-passing task stops passing.",
    filename: ".unown/memory/project.md",
    body: [
      "# Project Memory",
      "",
      "## Workflow",
      "- Run: bunx biome check --write on changed files in pi-repo/.",
      "- Verify engine restart: GET /api/overview returns ok:true.",
      "",
      "## Known pitfalls",
      "- Failed cycles auto-recover — do NOT restart engine to fix them.",
    ].join("\n"),
    caption2:
      "Verbatim lines from this repository's project memory, rendered by the Mem0-backed AutoDream. If a dream breaks the last-passing task, the log reads: rolled back to v5: canary task failed under the new memory.",
  },
];

/* ------------------------------------------------------------------ */
/* the pair — origin's argument, two cards                             */
/* ------------------------------------------------------------------ */

const TWO = [
  {
    glyph: "A" as const,
    title: "The terminal agent",
    body: "pi's TUI in your real project directory, with the memory stack already loaded. Alone: a good coding agent that forgets everything at midnight.",
    lines: ["unown", "unown --plan", "unown doctor"],
  },
  {
    glyph: "B" as const,
    title: "The engine behind it",
    body: "Sandboxed harness cycles and AutoDream consolidation, on a clock instead of in your session. It never touches your editor.",
    lines: JOB_LINES,
  },
];

/* ------------------------------------------------------------------ */
/* the five mechanisms + the SDLC index → moved to the dex (2026-10-20) */
/* ------------------------------------------------------------------ */

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
    <section data-hue="leaf" id="loop" className="scroll-mt-16 border-y border-line py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The learning loop">
            Most agents forget. This one has to prove it remembered.
          </SectionHead>
          <p className="mt-4 text-pretty leading-relaxed text-dim">
            Three steps, run continuously by the engine while you work — each tab
            shows the file that step actually writes.
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          <div
            role="tablist"
            aria-label="Stages of the learning loop"
            onKeyDown={onKeyDown}
            className="grid gap-px overflow-hidden border border-b-0 border-line bg-line sm:grid-cols-3"
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
                  className={`group relative flex items-center gap-3.5 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [transition-timing-function:steps(2,end)] ${
                    on ? "bg-panel-2" : "bg-panel hover:bg-panel-2"
                  }`}
                >
                  {/* the active marker is a bar, not a colour change: colour
                      alone fails 1.4.1 and this reads faster too */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 top-0 h-0.5 origin-left transition-transform duration-300 ${
                      on ? "scale-x-100 bg-gold" : "scale-x-0 bg-gold"
                    }`}
                  />
                  {on ? (
                    <PixelCursor className="size-2.5 shrink-0 text-gold" />
                  ) : (
                    <span className="size-2.5 shrink-0" aria-hidden="true" />
                  )}
                  <Glyph
                    id={b.glyph}
                    weight="heavy"
                    tone={on ? "lit" : "dim"}
                    className={`size-7 shrink-0 transition-colors ${
                      on ? "text-gold" : "text-faint group-hover:text-dim"
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
            className="border border-line p-6 focus:outline-none sm:p-8"
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
                    <div className="overflow-hidden border border-line">
                      <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2">
                        <span
                          className="size-1.5 rounded-full bg-gold/60"
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-[10.5px] text-faint">
                          {beat.filename}
                        </span>
                      </div>
                      <pre tabIndex={0} aria-label="terminal — session transcript" className="term-lines overflow-x-auto px-4 py-4 font-mono text-[11px] leading-relaxed text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:text-[11.5px]">
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

        {/* the pair — origin's "two halves" argument, two cards and one line */}
        <FadeUp className="mt-14">
          <div className="gb-panel p-5 sm:p-6">
            <div className="grid gap-6 sm:grid-cols-2">
              {TWO.map((half) => (
                <div key={half.glyph} className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-3">
                    <Glyph
                      id={half.glyph}
                      weight="heavy"
                      className="size-9 shrink-0 text-ink"
                    />
                    <h3 className="text-sm font-medium text-ink">{half.title}</h3>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-dim">{half.body}</p>
                  <ul className="mt-3 space-y-1">
                    {half.lines.map((l) => (
                      <li key={l} className="truncate font-mono text-[11px] text-faint">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-4 border-t border-line pt-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
                the odd power
              </span>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
              <span className="font-mono text-[11px] text-ink">
                notes → memory → a better next session
              </span>
            </div>
          </div>
        </FadeUp>

        {/* the five mechanisms + the SDLC index moved to the capability dex
            (#dex) with the creatures — this band keeps the process, the dex
            holds the catalog */}
      </div>
    </section>
  );
}
