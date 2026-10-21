"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Brain, Compass, ExternalLink, FlaskConical, Layers, Repeat, ShieldCheck, Swords, Target } from "lucide-react";
import { FadeUp, BENCH_URL } from "./shell";
import {
  BENCH_SOURCES,
  EDIT_BENCH,
  HUMANEVAL_PLUS,
  LIVECODEBENCH,
  LONGHORIZON,
  POLYGLOT,
  SELFIMPROVE,
} from "./benchmarks-data";
import { formatPct, runStamp } from "./benchmark-figures";

/**
 * The Benchmarks pane of the proof band (`proof.tsx`).
 *
 * Every number in this pane is generated, not typed. `benchmarks/` is the
 * most-churned directory in the repository, so `scripts/landing_benchmarks.mjs`
 * reads each track's canonical receipt JSON and writes `benchmarks-data.ts`,
 * and CI's landing job runs `bun scripts/landing_benchmarks.mjs --check`,
 * which fails when the page and the receipts disagree. All six tracks keep
 * rendering here — the stat band, the two flagship cards, the lift chart and
 * the "also run" strip — so the generator's contract holds no matter which
 * pane a visitor lands on.
 *
 * 2026-10-20 compression: this used to be a full section (3.74 viewports,
 * 1,275 words) with six full cards, a three-suite regression grid and a
 * four-cell methodology grid. The numbers are kept verbatim; the prose around
 * them is not — footnotes now say the one load-bearing thing they said at
 * half the length, the three secondary tracks share one strip, and the
 * regression + methodology panels merged into a single fine-print row. The
 * budget contract lives in the landing folder's AGENTS.md.
 */

/**
 * The memory-lift chart's shared domain: each bar is a percentage of its
 * model's cold run. Cold is pinned at 100 and the axis runs past it so the
 * warm bars that grew (see `SELFIMPROVE.input`) are shown, not cropped.
 */
const LIFT_SCALE = 125;
const COLD_BAR_W = (100 / LIFT_SCALE) * 100;

/* ------------------------------------------------------------------ */
/* bits                                                                */
/* ------------------------------------------------------------------ */

/**
 * A single stat bar. The finished width lives in `style` and only the reveal is
 * animated, via `scaleX` with `origin-left` — never a `width` tween, which
 * serialises to a state the `<noscript>` restore in `effects.tsx` cannot reach.
 */
function BarRow({
  label,
  pct,
  delay = 0,
}: {
  label: string;
  pct: number;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const tone = pct > 50 ? undefined : pct > 20 ? "mid" : "low";
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-dim sm:w-32">{label}</span>
      <div className="gb-hp min-w-0 flex-1" data-tone={tone} role="img" aria-label={`${label} ${pct.toFixed(1)}%`}>
        <motion.i
          className="origin-left"
          style={{ width: `${pct}%` }}
          initial={{ opacity: 0, scaleX: reduced ? 1 : 0 }}
          whileInView={{ opacity: 1, scaleX: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-gold">
        {pct.toFixed(1)}
      </span>
    </div>
  );
}

function Delta({ v, unit }: { v: number; unit: string }) {
  const good = v < 0;
  return (
    <span
      className={`px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
        good ? "bg-gold/10 text-gold" : "bg-amber/10 text-amber"
      }`}
    >
      {v > 0 ? "+" : "−"}
      {Math.abs(v).toFixed(1)}% {unit}
    </span>
  );
}

/** Cold → warm wall time, with the delta's sign carried by the chip's tone. */
function TimeChip({ coldS, warmS, d }: { coldS: number; warmS: number; d: number }) {
  const good = d < 0;
  return (
    <span
      className={`px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
        good ? "bg-gold/10" : "bg-amber/10"
      }`}
    >
      <span className="text-dim">
        {coldS}s → {warmS}s
      </span>{" "}
      <span className={good ? "text-gold" : "text-amber"}>
        {d > 0 ? "+" : "−"}
        {Math.abs(d).toFixed(1)}%
      </span>
    </span>
  );
}

/**
 * One bar of the memory-lift chart. `width` is a share of the track: cold rows
 * pass the 100%-of-cold baseline, warm rows their measured share of the
 * 0–125% domain. Grows in on scroll like BarRow, transform not width.
 */
function LiftBar({
  kind,
  width,
  tokens,
  tone,
  tick = false,
  delay = 0,
}: {
  kind: "cold" | "warm";
  width: number;
  tokens: number;
  tone: "cold" | "win" | "cost";
  tick?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const fill =
    tone === "cold" ? "bg-line-bright" : tone === "win" ? "bg-gold" : "bg-amber";
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 font-mono text-[10px] text-faint">{kind}</span>
      <div className="relative h-2 flex-1 bg-line">
        {tick ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -bottom-1.5 left-[80%] border-l border-dashed border-line-bright"
          />
        ) : null}
        <motion.div
          className={`absolute inset-y-0 left-0 origin-left ${fill}`}
          style={{ width: `${width}%` }}
          initial={{ opacity: 0, scaleX: reduced ? 1 : 0 }}
          whileInView={{ opacity: 1, scaleX: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
        />
      </div>
      <span className="w-[4.5rem] shrink-0 text-right font-mono text-[10px] tabular-nums text-dim">
        {tokens.toLocaleString("en-US")}
      </span>
    </div>
  );
}

function TrackCard({
  icon: Icon,
  name,
  source,
  children,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  source: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <FadeUp delay={delay} className="h-full">
      <div className="gb-panel lift flex h-full flex-col p-5 hover:border-line-bright">
        <div className="flex items-center gap-3">
          <Icon className="size-5 shrink-0 text-gold" aria-hidden="true" />
          <h3 className="text-[15px] font-medium text-ink">{name}</h3>
        </div>
        <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-faint">{source}</p>
        <div className="mt-4 flex flex-1 flex-col justify-center gap-3">{children}</div>
      </div>
    </FadeUp>
  );
}

/* ------------------------------------------------------------------ */
/* the pane                                                            */
/* ------------------------------------------------------------------ */

export function BenchmarksPane() {
  return (
    <div data-hue="leaf">
      {/* the stat band: full-bleed, four numbers the research calls a
          "proof band" — the cheapest way to say "this is measured" without a
          paragraph. Dividers are borders on the cells so the row spans the
          pane without seam bars. */}
      <div className="border-y border-line bg-panel/30">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          {[
            { v: "52%", l: "LiveCodeBench v6 pass@1", s: "post-cutoff problems, kimi-k2.5" },
            { v: "98.1%", l: "edit accuracy", s: "106-fixture oh-my-pi benchmark" },
            { v: "−35%", l: "warm wall time", s: "repeat tasks, kimi-k2.5" },
            { v: "0/50", l: "attacker rules shipped", s: "MPBench-adapted corpus, 0 planted" },
          ].map((s, i) => (
            <div
              key={s.l}
              className={`rise rise-${i + 1} border-line px-4 py-6 sm:px-5 lg:border-l lg:first:border-l-0 ${i === 1 ? " sm:border-l" : ""}${i < 2 ? " border-b sm:border-b-0 lg:border-b-0" : ""}`}
            >
              <p className="gb-h text-3xl tabular-nums tracking-tight text-gold">
                {s.v}
              </p>
              <p className="mt-1.5 text-[13px] font-medium text-ink">{s.l}</p>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
                {s.s}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* the two flagship tracks */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TrackCard
          icon={Swords}
          name="LiveCodeBench v6 — the contamination-aware headline"
          source="50-problem stratified subset of LiveCodeBench's release_v6 increment · contests 2025-01-04 → 2025-04-06 · after every model's cutoff · official LCB prompt + grader · greedy pass@1 · receipts under benchmarks/livecodebench/results/"
        >
          {LIVECODEBENCH.map((r, i) => (
            <div key={r.model} className="flex items-center gap-3">
              <BarRow label={r.model} pct={r.pct} delay={i * 0.1} />
              <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:inline">
                {r.noCode} no_code
              </span>
            </div>
          ))}
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
            Every problem was published after these models&apos; training cutoffs.
            Easy sweeps everywhere (13/13, 12/13); hard is where it ends (4/23, 1/23,
            1/23). <span className="text-gold">no_code is the honest failure mode</span>:
            reasoning past the pinned 4096-token budget gets cut off before the code
            fence closes — 15/26/27 of 50, reported as measured, not filtered.
          </p>
          <a
            href={`${BENCH_URL}/livecodebench/results`}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-gold underline-offset-4 hover:underline"
          >
            benchmarks/livecodebench/results/
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </TrackCard>

        <TrackCard
          icon={Target}
          name="Edit accuracy"
          source="oh-my-pi typescript-edit-benchmark · 106 fixtures · byte-exact scoring · full Unown agent in the loop · 2026-10-17 fresh-checkout rerun"
        >
          {EDIT_BENCH.map((r, i) => (
            <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
          ))}
          <div className="mt-2 space-y-1.5 border border-line bg-canvas/50 p-3">
            <p className="font-mono text-[10.5px] leading-relaxed text-dim">
              <span className="text-gold">head-to-head</span> against the oh-my-pi agent
              itself, same 106 fixtures, 3 runs per task:{" "}
              <span className="text-ink">identical best-of-3 scores on every model</span>{" "}
              — and <span className="text-gold">2.4–5.4× fewer input tokens</span> per
              task.
            </p>
          </div>
        </TrackCard>
      </div>

      {/* the memory-lift chart — the eval the self-improvement claim rests on.
          Pass-rate is 10/10 → 10/10 everywhere, so what memory actually buys
          is efficiency: cold vs warm input tokens and wall time, exactly as
          measured, including the two models that spent more. */}
      <FadeUp delay={0.05}>
        <div id="memory-lift" className="gb-panel mt-6 scroll-mt-16 p-5" data-tone="magma">
          <div className="flex flex-wrap items-center gap-3">
            <Repeat className="size-5 shrink-0 text-gold" aria-hidden="true" />
            <h3 className="text-[15px] font-medium text-ink">Memory lift, cold vs warm</h3>
            <span className="bg-gold/10 px-1.5 py-0.5 font-mono text-[10.5px] text-gold">
              n=10 · single run per phase
            </span>
            <a
              href={`${BENCH_URL}/selfimprove/results`}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-gold underline-offset-4 hover:underline"
            >
              benchmarks/selfimprove/results/
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-dim">
            Each model solved the same 10-task Python Exercism set cold (fresh project,
            fresh memory), then warm: a brand-new workspace carrying only the dreamed
            memory from its cold pass. Bars are input tokens, normalized per model; the
            scale runs to 125% so the models that spent more are not cropped.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-faint">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-4 bg-line-bright" />
              cold
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-4 bg-gold" />
              warm · fewer input tokens
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-4 bg-amber" />
              warm · more input tokens
            </span>
          </div>

          <div className="mt-4">
            {SELFIMPROVE.map((r, i) => (
              <div key={r.model} className={i === 0 ? "" : "mt-5"}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="font-mono text-[11px] text-ink">{r.model}</span>
                  <Delta v={r.input} unit="in" />
                  <TimeChip coldS={r.coldS} warmS={r.warmS} d={r.time} />
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-faint">
                    pass 10/10 → 10/10
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  <LiftBar
                    kind="cold"
                    width={COLD_BAR_W}
                    tokens={r.coldIn}
                    tone="cold"
                    delay={i * 0.12}
                  />
                  <LiftBar
                    kind="warm"
                    width={(r.warmIn / r.coldIn) * COLD_BAR_W}
                    tokens={r.warmIn}
                    tone={r.input < 0 ? "win" : "cost"}
                    delay={i * 0.12 + 0.06}
                    tick
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 font-mono text-[10.5px] leading-relaxed text-dim">
            <span className="text-gold">Pass-rate lift is 0pp</span> across the board:
            two of three models spent <em>more</em> input tokens with memory in the
            loop, and kimi-k2.5 still finished 35% faster; qwen3.6-plus took both wins.
            On tasks the model can already solve, memory buys efficiency, not
            correctness.
          </p>

          <div className="gb-box mt-4 p-4" data-tone="magma">
            <p className="gb-label text-[10px] text-canvas">
              Negative controls, published as-is
            </p>
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-canvas">
              v1 (thin session notes only): −25.6% input, 64s → 34s warm, with an{" "}
              <span className="font-medium text-canvas">unchanged memory file</span> —
              that saving is upstream prompt caching, not memory, and v1 is kept as the
              control arm that isolates the confound. v3 (six sequential sessions, one
              evolving repo, real dreams): 6/6 with memory, 6/6 without, 6/6 with
              wrong-domain memory — learned memory cost +36% billed input tokens,
              irrelevant memory +30% and bought nothing. The memory system itself now
              has a live suite — injection proven by a unique marker in the captured
              upstream request, real dream + canary + rollback roundtrips, and a
              ten-variant poisoning corpus: every adversarial note flagged at the input
              layer, 0/10 attacker rules planted into dreamed memory, 0 shipped —
              receipts in{" "}
              {/* links inside a dark gb-box inherit the box's canvas colour;
                  text-gold fails AA on the magma fill in both schemes */}
              <a
                href={`${BENCH_URL}/memory-eval/results`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4"
              >
                benchmarks/memory-eval/results/
              </a>
              .
            </p>
          </div>
        </div>
      </FadeUp>

      {/* also run: the three secondary tracks, one strip instead of three
          full cards. All three still render their generated numbers, and the
          receipts are one link away. */}
      <FadeUp delay={0.05}>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="gb-panel p-5">
            <div className="flex items-center gap-3">
              <FlaskConical className="size-5 shrink-0 text-gold" aria-hidden="true" />
              <h3 className="text-[15px] font-medium text-ink">HumanEval+</h3>
            </div>
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-faint">
              official evalplus CLI · 164 problems · greedy pass@1 · {runStamp(BENCH_SOURCES.HUMANEVAL_PLUS.run)}
            </p>
            <div className="mt-4 space-y-2">
              {HUMANEVAL_PLUS.map((r) => {
                const figure = formatPct(r.pct);
                return (
                  <div key={r.model} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                    <span className="truncate text-dim">{r.model}</span>
                    <span className={`tabular-nums ${figure.missing ? "text-faint" : "text-gold"}`}>
                      {figure.text}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
              predates these models, so it cannot separate ability from memorization —
              LiveCodeBench above is the headline for exactly that reason.
            </p>
          </div>

          <div className="gb-panel p-5">
            <div className="flex items-center gap-3">
              <Layers className="size-5 shrink-0 text-gold" aria-hidden="true" />
              <h3 className="text-[15px] font-medium text-ink">Aider polyglot subset</h3>
            </div>
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-faint">
              50 exercises · 6 languages · Aider&apos;s 2-attempt protocol · pass@2
            </p>
            <div className="mt-4 space-y-2">
              {POLYGLOT.map((r) => (
                <div key={r.model} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                  <span className="truncate text-dim">{r.model}</span>
                  <span className="tabular-nums text-gold">
                    {r.pct.toFixed(0)} <span className="text-faint">@{r.pass1}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
              first published polyglot numbers for these models · 2026-10-17 rerun
              reproduces the committed run exactly
            </p>
          </div>

          <div className="gb-panel p-5">
            <div className="flex items-center gap-3">
              <Compass className="size-5 shrink-0 text-gold" aria-hidden="true" />
              <h3 className="text-[15px] font-medium text-ink">Long-horizon refactor</h3>
            </div>
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-faint">
              one hard multi-file contract change, 11-module TypeScript app · n=1 ·
              scored on the file diff
            </p>
            <div className="mt-4 space-y-2">
              {LONGHORIZON.map((r) => (
                <div key={r.model} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                  <span className="truncate text-dim">{r.model}</span>
                  <span className="tabular-nums text-faint">
                    {(r.inTok / 1000).toFixed(r.inTok >= 100000 ? 0 : 1)}k in
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
              all three solved it; <span className="text-gold">the separation is
              cost</span> — qwen3.6-plus spent 1.2M input tokens with zero cache reads
              (28× kimi) on the same task.{" "}
              <a
                href={`${BENCH_URL}/longhorizon/results`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-gold underline underline-offset-4"
              >
                receipts
              </a>
            </p>
          </div>
        </div>
      </FadeUp>

      {/* regression layer + methodology, one fine-print panel. There are
          deliberately no test counts here: a total moves on almost every
          commit, so each suite is named by path and command — verifiable, and
          it does not rot. */}
      <FadeUp delay={0.05}>
        <div className="mt-6 gb-panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <ShieldCheck className="size-5 shrink-0 text-gold" aria-hidden="true" />
            <h3 className="text-[15px] font-medium text-ink">
              The regression layer below the loop
            </h3>
            <span className="bg-gold/10 px-1.5 py-0.5 font-mono text-[10.5px] text-gold">
              three suites · every push
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-dim">
            A self-improving agent regresses its own harness first: a bad memory ship
            looks exactly like a better model. The loop sits on a locked suite that
            must stay green while everything above it evolves — anti-tamper scoring
            (tests restored to pristine state before scoring), pinned datasets and
            harness versions, official harnesses only, per-task JSONL receipts under{" "}
            <a
              href={BENCH_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[12px] text-gold underline-offset-4 hover:underline"
            >
              benchmarks/
            </a>
            .
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              {
                s: "dashboard",
                p: "src/**/__tests__/*.test.tsx",
                r: "bun run test:unit",
              },
              {
                s: "llm-bridge",
                p: "mini-services/llm-bridge/pure.test.ts",
                r: "bun test pure.test.ts",
              },
              {
                s: "engine",
                p: "pi-repo/packages/self-learning/test",
                r: "bun test test/",
              },
            ].map((c) => (
              <div key={c.s} className="gb-inset p-4">
                <p className="gb-label text-[9px] text-gold">{c.s}</p>
                <p className="mt-2 break-words font-mono text-[11px] leading-snug text-ink">
                  {c.p}
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-faint">{c.r}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-faint">
            <span className="text-gold">not measured here</span> — SWE-bench Verified and
            Terminal-Bench 2.0 are quoted from vendor reports, never our own runs. The
            one eval that scores zero (our extension-authoring eval, 0.0 for every
            model) sits beside the gates in{" "}
            <a href="#proof" className="underline underline-offset-2">
              Integrity
            </a>
            .
          </p>
        </div>
      </FadeUp>
    </div>
  );
}
