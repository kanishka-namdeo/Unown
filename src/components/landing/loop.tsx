"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { FadeUp, SectionHead, PixelCursor, GITHUB_URL } from "./shell";
import { ENGINE_JOBS, ENGINE_JOB_COUNTS } from "./engine-data";

/**
 * The "how it learns" band — one section where the page used to spend three.
 *
 * Origin (the two-halves argument), the loop (the three tabbed artifacts) and
 * mechanisms (the five answers) told one story across 1,179 words and four
 * sub-headers; a visitor met the same "notes → memory → a better session"
 * idea four times before the screenshots. The 2026-10-20 round merged them:
 * the beats tabs stay verbatim (they are the receipts — every body is the
 * literal format the engine writes, gated by `scripts/landing_claims.mjs`),
 * the pair strip carries origin's argument in two cards, and the five
 * mechanisms became a bento whose sixth tile is the SDLC-parity index that
 * used to be eight tiles of its own.
 */

const SRC = (file: string) => `${GITHUB_URL}/blob/main/pi-repo/packages/self-learning/src/${file}`;

const NUM_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/** Spelled out because the sentence reads as prose; a count past twelve falls
 *  back to digits rather than silently saying "thirteen" wrong. */
const word = (n: number) => NUM_WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The job tallies are derived from `JOB_DEFS` in `router.ts` via
 * `scripts/landing_claims.mjs`, so the routing tile cannot drift from the
 * scheduler the way a hand-typed "seven / five / two" would.
 */
const JOB_SENTENCE =
  `${cap(word(ENGINE_JOB_COUNTS.total))} jobs keep the loop moving in the background ` +
  `without you: ${word(ENGINE_JOB_COUNTS.interval)} on a timer, ` +
  `${word(ENGINE_JOB_COUNTS.event)} on events.`;

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
    lead: "AutoDream merges duplicates, drops stale observations and reorganises into topic sections. Its prompt tells it to never delete hard-won rules and to keep the file under 120 lines. A canary run gates the whole thing, and rolls it back if the last-passing task stops passing.",
    filename: ".unown/memory/project.md",
    body: [
      "# Tier 1 — Project Memory",
      "",
      "## Engine restart procedure",
      "- Find bun --hot PID with cwd mini-services/agent-service via /proc/<pid>/cwd.",
      "- bun --hot does NOT reload changes outside mini-services/.",
      "",
      "## Known pitfalls",
      "- LLM bridge calls timeout at 240s with 3 retries; agent watchdog at 600s.",
      "- Failed cycles auto-recover — do NOT restart engine to fix them.",
    ].join("\n"),
    caption2:
      "Verbatim lines from this repository's project memory, written by AutoDream. If a dream breaks the last-passing task, the log reads: rolled back to v5: canary task failed under the new memory.",
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
/* the five mechanisms + the SDLC index, one bento                      */
/* ------------------------------------------------------------------ */

type Mechanism = {
  n: string;
  title: string;
  pain: string;
  body: string;
  file: string;
  href: string;
};

const MECHANISMS: Mechanism[] = [
  {
    n: "01",
    title: "Tiered memory",
    pain: "re-explaining the project every session",
    body: "Four tiers — policy, project, user, local. Most-specific-wins, injected into every prompt; every write versioned and attributed.",
    file: "memory.ts",
    href: SRC("memory.ts"),
  },
  {
    n: "02",
    title: "Self-improving harness",
    pain: "it fixed the bug by editing the test",
    body: "A failing benchmark task runs in a fresh sandbox; the transcript is mined for the rule that would have prevented it, and the candidate re-runs against the patched memory.",
    file: "harness.ts",
    href: SRC("harness.ts"),
  },
  {
    n: "03",
    title: "Routing",
    pain: "improvement only happens when you remember to run it",
    body: `${JOB_SENTENCE} A busy-mutex means the sandbox is never double-driven.`,
    file: "router.ts",
    href: SRC("router.ts"),
  },
  {
    n: "04",
    title: "AutoDreaming + skills",
    pain: "you find out it learned the wrong thing weeks later",
    body: "Notes consolidate into project memory; recurring procedures get minted as real Agent Skills. The engine never deletes your files — retirement is a dashboard action.",
    file: "dream.ts",
    href: SRC("dream.ts"),
  },
  {
    n: "05",
    title: "Hooks",
    pain: "it ran something it had no business running",
    body: "Guardrails at six layers — before the prompt, around every tool call, at session and subagent end — every allow, deny and augment logged.",
    file: "hooks.ts",
    href: SRC("hooks.ts"),
  },
];

/**
 * The SDLC-parity surface (Milestones 1-4), as the bento's sixth tile.
 * Reverse-engineered from the 2026-10-19 sweep across nine coding agents —
 * every capability landed on pi's documented seams. The receipts and design
 * decisions live in `docs/sdlc-feature-parity.md` Round 5; the FAQ's
 * "What can it actually do?" answer repeats the capability names in prose.
 */
const SDLC = {
  n: "06",
  title: "SDLC parity",
  pain: "the 2026 coding agents set the bar",
  body: "Multi-type hooks, Adversary Mode + injection scanner, Per-subagent routing, Recipes, Repo Wiki, /init + /doctor, /blame + /sessions, Auto-compact — 15 ports across four milestones.",
  file: "docs/sdlc-feature-parity.md",
  href: `${GITHUB_URL}/blob/main/docs/sdlc-feature-parity.md`,
};

/** Receipt links for the SDLC tile: one per ported capability, straight at
 *  the source file that implements it. */
const SDLC_SRC: [string, string][] = [
  ["hooks-config.ts", SRC("hooks-config.ts")],
  ["adversary.ts", SRC("adversary.ts")],
  ["subagent-routing.ts", SRC("subagent-routing.ts")],
  ["recipes.ts", SRC("recipes.ts")],
  ["repo-wiki.ts", SRC("repo-wiki.ts")],
  ["init-agents.ts", SRC("init-agents.ts")],
  ["blame.ts", SRC("blame.ts")],
  ["auto-compact.ts", SRC("auto-compact.ts")],
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
    <section data-hue="leaf" id="loop" className="scroll-mt-16 border-y border-line py-16 sm:py-20">
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

        {/* the five mechanisms + the SDLC index, one bento */}
        <FadeUp className="mt-14 max-w-2xl">
          <SectionHead kicker="Five mechanisms">
            Three pains, five answers.
          </SectionHead>
        </FadeUp>
        <div className="mt-8 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {[...MECHANISMS, SDLC].map((m, i) => (
            <FadeUp key={m.n} delay={Math.min(i, 3) * 0.04} className="bg-panel p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="gb-label text-[10px] tabular-nums text-gold">{m.n}</p>
                {m.n === "06" ? (
                  <span className="gb-label text-[8px] text-faint">15 ports · M1-M4</span>
                ) : null}
              </div>
              <h3 className="mt-3 text-[15px] font-medium text-ink">{m.title}</h3>
              <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                {m.pain}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-dim">{m.body}</p>
              {m.n === "06" ? (
                <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {SDLC_SRC.map(([label, href]) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[10px] text-faint underline underline-offset-2 transition-colors hover:text-gold"
                    >
                      {label}
                    </a>
                  ))}
                </p>
              ) : null}
              <a
                href={m.href}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-gold underline-offset-4 hover:underline"
              >
                {m.file}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}
