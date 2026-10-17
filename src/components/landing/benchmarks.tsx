"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Brain, ExternalLink, FlaskConical, Layers, Repeat, ShieldCheck, Swords, Target } from "lucide-react";
import { FadeUp, BENCH_URL, SectionHead } from "./shell";

/**
 * Every number here comes from a real run with receipts committed under
 * `benchmarks/`. Measured 2026-10-16, greedy decoding, through the bundled
 * llm-bridge on Dashscope (kimi-k2.5 / qwen3.7-plus / qwen3.6-plus); tracks
 * re-verified from a fresh checkout on 2026-10-17 (evalplus + edit-bench
 * consts below carry the fresh numbers; per-track receipts under
 * benchmarks/<track>/results/rerun-2026-10-17/). LiveCodeBench v6 was run
 * 2026-10-17, same bridge, same decoding — receipts under
 * benchmarks/livecodebench/results/.
 * When a run lands, update the consts and the receipts in the same commit.
 */

const EDIT_BENCH = [
  { model: "kimi-k2.5", pct: 98.1 },
  { model: "qwen3.7-plus", pct: 96.2 },
  { model: "qwen3.6-plus", pct: 94.3 },
];

const HUMANEVAL_PLUS = [
  { model: "kimi-k2.5", pct: 93.9 },
  { model: "qwen3.6-plus", pct: 93.3 },
  { model: "qwen3.7-plus", pct: 92.7 },
];

/**
 * LiveCodeBench release_v6 increment (contests 2025-01-04 → 2025-04-06) —
 * after every one of these models' knowledge cutoffs, so nothing here can be
 * memorized. 50-problem stratified subset (see benchmarks/livecodebench/
 * dataset/subset.json), official LCB prompt + grader logic, greedy pass@1.
 * no_code = the model spent the whole 4096-token budget without closing a
 * fenced code block — reported as a fail, not filtered.
 */
const LIVECODEBENCH = [
  { model: "kimi-k2.5", pct: 52, noCode: 15 },
  { model: "qwen3.7-plus", pct: 38, noCode: 26 },
  { model: "qwen3.6-plus", pct: 36, noCode: 27 },
];

const POLYGLOT = [
  { model: "qwen3.6-plus", pct: 96, pass1: 96 },
  { model: "qwen3.7-plus", pct: 96, pass1: 96 },
  { model: "kimi-k2.5", pct: 94, pass1: 94 },
];

/**
 * Repeat-task efficiency, cold vs warm — v2 protocol, agent-authored notes.
 * Deltas are the published percentages; the raw input-token totals and
 * per-phase average durations come from
 * benchmarks/selfimprove/results/v2-notes/summary.*.json (n=10, single run).
 */
const SELFIMPROVE = [
  { model: "qwen3.6-plus", input: -23.7, time: -8.0, coldIn: 401445, warmIn: 306218, coldS: 25, warmS: 23 },
  { model: "kimi-k2.5", input: 21.8, time: -35.1, coldIn: 34553, warmIn: 42075, coldS: 37, warmS: 24 },
  { model: "qwen3.7-plus", input: 23.2, time: 4.2, coldIn: 64853, warmIn: 79886, coldS: 24, warmS: 25 },
];

/**
 * The memory-lift chart's shared domain: each bar is a percentage of its
 * model's cold run. Cold is pinned at 100 and the axis runs to 125 so the
 * warm bars that grew (kimi +21.8%, qwen3.7 +23.2%) are shown, not cropped.
 */
const LIFT_SCALE = 125;
const COLD_BAR_W = (100 / LIFT_SCALE) * 100;

/* ------------------------------------------------------------------ */
/* bits                                                                */
/* ------------------------------------------------------------------ */

function BarRow({
  label,
  pct,
  delay = 0,
}: {
  label: string;
  pct: number;
  delay?: number;
}) {
  const tone = pct > 50 ? undefined : pct > 20 ? "mid" : "low";
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-dim sm:w-32">{label}</span>
      <div className="gb-hp min-w-0 flex-1" data-tone={tone} role="img" aria-label={`${label} ${pct.toFixed(1)}%`}>
        <motion.i
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
          style={{ transition: "none" }}
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
 * 0–125% domain. Grows in on scroll like BarRow, but the finished width ships
 * in the SSR markup and the grow is a transform — so the noscript
 * reveal-restore in effects.tsx (which keys on opacity+transform) resolves
 * these bars to their final state without scripting, unlike a width tween.
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
      <div className="gb-panel lift flex h-full flex-col p-6 hover:border-line-bright">
        <div className="flex items-center gap-3">
          <Icon className="size-5 shrink-0 text-gold" aria-hidden="true" />
          <h3 className="text-[15px] font-medium text-ink">{name}</h3>
        </div>
        <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-faint">{source}</p>
        <div className="mt-5 flex flex-1 flex-col justify-center gap-3">{children}</div>
      </div>
    </FadeUp>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function BenchmarksSection() {
  return (
    <section data-hue="leaf" id="benchmarks" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="Methodology and receipts"
            lead={
              <>
                Official harnesses, pinned datasets, anti-tamper scoring, and per-task JSONL in
                the repo. The warm-memory panel below is published exactly as measured: two of
                three models used <em>more</em> input tokens with memory in the loop, and we
                left that in.
              </>
            }
          >
            Benchmarked where it hurts, including where it loses.
          </SectionHead>
        </FadeUp>

        {/* Full-bleed on purpose. Every other section runs inside the container;
            letting four numbers run edge to edge is the cheapest way to break a
            page that has started to feel like one long column. Dividers are
            borders on the cells rather than grid gaps, so the row spans the
            viewport without seam bars where the grid runs out. */}
        <div className="mt-12 border-y border-line bg-panel/30">
          <div className="mx-auto grid max-w-6xl px-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {[
              { v: "52%", l: "LiveCodeBench v6 pass@1", s: "post-cutoff problems, kimi-k2.5" },
              { v: "98.1%", l: "edit accuracy", s: "106-fixture oh-my-pi benchmark" },
              { v: "−35%", l: "warm wall time", s: "repeat tasks, kimi-k2.5" },
              { v: "5,342", l: "repo tests green", s: "pi monorepo + engine, 0 failing" },
            ].map((s, i) => (
              <div
                key={s.l}
                className={`rise border-line py-8 sm:px-5 lg:border-l lg:first:border-l-0 ${i === 1 ? " sm:border-l" : ""}${i < 2 ? " border-b sm:border-b-0 lg:border-b-0" : ""}`}
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

        {/* tracks */}
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
              HumanEval+ (below) predates these models, so its 90s cannot separate ability
              from memorization. These problems were published after their cutoffs. Every
              model sweeps easy (13/13, 12/13); hard is where it ends (4/23, 1/23, 1/23).
            </p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
              <span className="text-gold">no_code is the honest failure mode</span>: at the
              pinned 4096-token budget, a model that reasons at length gets cut off before
              closing its code fence — 15/26/27 of 50. Reported as measured, not filtered;
              larger-budget runs are future work, not a silent re-run.
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
                itself, same 106 fixtures, edit format pinned, 3 runs per task:{" "}
                <span className="text-ink">identical best-of-3 scores on every model</span>,{" "}
                — and <span className="text-gold">2.4–5.4× fewer input tokens</span> per
                task.
              </p>
              <p className="font-mono text-[10.5px] leading-relaxed text-dim">
                2026-10-17 fresh-checkout rerun: kimi reproduces exactly (98.1); the
                n=1 qwen spread sits inside the flake band the n=3 pass quantified.
              </p>
            </div>
          </TrackCard>

          <TrackCard
            icon={FlaskConical}
            name="HumanEval+"
            source="official evalplus CLI · sanitize → evaluate · pass@1 · greedy · 164 problems · 2026-10-17 fresh-checkout rerun"
            delay={0.05}
          >
            {HUMANEVAL_PLUS.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <p className="mt-1 font-mono text-[10px] text-faint">
              base HumanEval, for reference: 97.6 / 98.2 / 98.2 · prior committed run:
              93.3 / 93.9 / 93.3 — ±1 problem, greedy-decoding noise
            </p>
          </TrackCard>

          <TrackCard
            icon={Brain}
            name="Self-improvement, measured"
            source="10-task repeat set · cold vs warm, dreamed memory carried into fresh workspaces · 60/60 passed across six passes · v2 agent-authored notes · receipts under benchmarks/selfimprove/results/"
            delay={0.1}
          >
            {SELFIMPROVE.map((r) => (
              <div key={r.model} className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 truncate font-mono text-[11px] text-dim">
                  {r.model}
                </span>
                <Delta v={r.input} unit="in" />
                <Delta v={r.time} unit="time" />
              </div>
            ))}
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
              pass 10/10 → 10/10 on every model, both passes — memory buys efficiency,
              not correctness; the full{" "}
              <a href="#memory-lift" className="text-gold underline-offset-2 hover:underline">
                cold-vs-warm chart
              </a>{" "}
              is below.
            </p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
              A caching-only control in v1 faked −25.6%. We publish the real memory effect
              instead.
            </p>
          </TrackCard>

          <TrackCard
            icon={Layers}
            name="Aider polyglot subset"
            source="50-exercise stratified subset of Aider-AI/polyglot-benchmark · 6 languages · Aider's 2-attempt protocol · pass@2 shown · 2026-10-17 fresh-checkout rerun"
            delay={0.15}
          >
            {POLYGLOT.map((r, i) => (
              <div key={r.model} className="flex items-center gap-3">
                <BarRow label={r.model} pct={r.pct} delay={i * 0.1} />
                <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:inline">
                  @{r.pass1}
                </span>
              </div>
            ))}
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
              first published polyglot numbers for these models · 2026-10-17
              fresh-checkout rerun: pass@1 reproduces the committed run exactly
              (47/48/48 of 50) · 300 scored runs across two days
            </p>
          </TrackCard>
        </div>

        {/* The memory-lift chart testing-strategy §7A asked for, in the form
            our data can publish: pass-rate is 10/10 → 10/10 everywhere, so what
            memory actually buys is efficiency — cold vs warm input tokens and
            wall time, exactly as measured, including the two models that spent
            more. Full-width because paired bars plus raw counts need the room;
            it also breaks the column rhythm between the track grid and the
            regression panel, the way the stat band does above. */}
        <FadeUp delay={0.05}>
          <div id="memory-lift" className="gb-panel mt-6 scroll-mt-16 p-6" data-tone="magma">
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
              The eval the self-improvement claim rests on: each model solved the same
              10-task Python Exercism set cold (fresh project, fresh memory), then warm:
              a brand-new workspace carrying only the dreamed memory from its cold pass,
              no source files shared, memory verified changed per task before the warm
              pass. Bars are input tokens, normalized per model: cold is the 100%
              baseline, the dashed tick marks it, and the scale runs to 125% so the models
              that spent more are not cropped.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-faint">
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
              <span className="ml-auto hidden lg:inline">
                input tokens per model · dashed tick = cold (100%), scale 0–125%
              </span>
            </div>

            <div className="mt-4">
              {SELFIMPROVE.map((r, i) => (
                <div key={r.model} className={i === 0 ? "" : "mt-6"}>
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
              two of three models spent <em>more</em> input tokens with memory in the loop,
              and kimi-k2.5 still finished 35% faster; qwen3.6-plus took both wins. On
              tasks the model can already solve, memory buys efficiency, not correctness.
              Single run per phase, so the deltas are direction rather than significance.
            </p>

            <div className="gb-box mt-4 p-4" data-tone="magma">
              <p className="gb-label text-[10px] text-canvas">
                Negative control (v1): not published as a memory effect
              </p>
              <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-canvas">
                kimi-k2.5 with only thin session summaries as notes showed −25.6% input
                and 64s → 34s (−46.9%) wall time warm, with an{" "}
                <span className="font-medium text-canvas">unchanged memory file</span>. That saving is
                upstream prompt caching on near-identical prompts, not memory; v1 is
                kept as the control arm that isolates the confound. v2 above is what we
                publish, with per-task dreamed-memory receipts committed.
              </p>
            </div>
          </div>
        </FadeUp>

        {/* The regression layer below the loop: tests that protect the harness
            while the agent rewrites itself. Numbers are the committed test
            suites — checkable by running them. */}
        <FadeUp delay={0.05}>
          <div className="mt-6 gb-panel p-6">
            <div className="flex flex-wrap items-center gap-3">
              <ShieldCheck className="size-5 shrink-0 text-gold" aria-hidden="true" />
              <h3 className="text-[15px] font-medium text-ink">
                The regression layer below the loop
              </h3>
              <span className="bg-gold/10 px-1.5 py-0.5 font-mono text-[10.5px] text-gold">
                641 harness tests · 0 fail
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-dim">
              A self-improving agent regresses its own harness first: a bad memory ship
              looks exactly like a better model. So the loop sits on a locked suite that
              must stay green while everything above it evolves: the dashboard&apos;s pure
              logic, the bridge&apos;s routing and retry math, the engine&apos;s memory
              versioning, task tamper-gate, sandbox profile and hook decisions.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {[
                {
                  v: "162",
                  l: "dashboard unit tests",
                  d: "zustand event store, API error mapping, toast reducer, formatting table-drivers",
                },
                {
                  v: "95",
                  l: "llm-bridge unit tests",
                  d: "model routing, tool-call sanitizing, SSE stats folding, retry/backoff math; 6,197 assertions",
                },
                {
                  v: "384",
                  l: "engine unit tests",
                  d: "memory tiers + rollback, sha256 tamper gate, mint validation, busy-mutex, bwrap profile, hook corpus",
                },
              ].map((c) => (
                <div key={c.l} className="gb-inset p-4">
                  <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-gold">
                    {c.v}
                  </p>
                  <p className="mt-1 text-[13px] font-medium text-ink">{c.l}</p>
                  <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">{c.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10.5px] leading-relaxed text-faint">
              <span>
                <span className="text-gold">CI</span> lint · typecheck · unit · shell-syntax
                · theme, every push
              </span>
              <span>
                <span className="text-gold">hook corpus</span> 38 adversarial commands; the
                bypasses the corpus found (wrapped <span className="text-ink">rm -rf /</span>,
                <span className="text-ink"> $&#123;HOME&#125;</span> expansion, fork-bomb
                variants, numeric-IP egress, symlink jail escape) are closed and pinned
              </span>
              <span>
                <span className="text-gold">runs on</span> bun test · zero new dependencies
              </span>
            </div>
          </div>
        </FadeUp>

        {/* methodology + what we did not do */}
        <FadeUp delay={0.08}>
          <div className="mt-6 grid gap-6 gb-panel p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <p className="gb-label text-[10px] text-gold">
                Methodology
              </p>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {[
                  {
                    t: "Anti-tamper scoring",
                    d: "Tests are restored to pristine state before scoring; reference solutions never enter the agent workspace.",
                  },
                  {
                    t: "Pinned everything",
                    d: "Dataset commits, model-catalog snapshots and harness versions are pinned and committed.",
                  },
                  {
                    t: "Official harnesses",
                    d: "evalplus CLI, oh-my-pi's own edit benchmark, Aider's polyglot protocol; nothing home-rolled.",
                  },
                  {
                    t: "Receipts in the repo",
                    d: "Per-task JSONL with tokens, durations and outcomes for every run lives under benchmarks/.",
                  },
                ].map((m) => (
                  <div key={m.t}>
                    <p className="text-[13px] font-medium text-ink">{m.t}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-faint">{m.d}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="gb-box p-4">
              <p className="gb-label text-[10px] text-canvas">
                What we did not run
              </p>
              <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-canvas">
                <li>
                  <span className="font-medium text-canvas">SWE-bench Verified</span> and{" "}
                  <span className="font-medium text-canvas">Terminal-Bench 2.0</span> are quoted from
                  vendor reports, not measured here.
                </li>
                <li>
                  Our own <span className="font-medium text-canvas">extension-authoring eval</span> scores{" "}
                  <span className="font-medium text-canvas">0.0</span> for every model. Reported as-is.
                </li>
              </ul>
              <a
                href={BENCH_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-canvas underline-offset-4 hover:underline"
              >
                benchmarks/
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}