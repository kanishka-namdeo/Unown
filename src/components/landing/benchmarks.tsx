"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Brain, ExternalLink, FlaskConical, Layers, Target } from "lucide-react";
import { FadeUp, BENCH_URL } from "./shell";

/**
 * Every number here comes from a real run with receipts committed under
 * `benchmarks/`. Measured 2026-10-16, greedy decoding, through the bundled
 * llm-bridge on Dashscope (kimi-k2.5 / qwen3.7-plus / qwen3.6-plus).
 * When a run lands, update the consts and the receipts in the same commit.
 */

const EDIT_BENCH = [
  { model: "qwen3.7-plus", pct: 99.1 },
  { model: "qwen3.6-plus", pct: 99.1 },
  { model: "kimi-k2.5", pct: 98.1 },
];

const HUMANEVAL_PLUS = [
  { model: "qwen3.6-plus", pct: 93.9 },
  { model: "kimi-k2.5", pct: 93.3 },
  { model: "qwen3.7-plus", pct: 93.3 },
];

const POLYGLOT = [
  { model: "qwen3.6-plus", pct: 100, pass1: 96 },
  { model: "kimi-k2.5", pct: 98, pass1: 94 },
  { model: "qwen3.7-plus", pct: 98, pass1: 96 },
];

/** Repeat-task efficiency, cold vs warm — v2 protocol, agent-authored notes. */
const SELFIMPROVE = [
  { model: "qwen3.6-plus", input: -23.7, time: -8.0 },
  { model: "kimi-k2.5", input: 21.8, time: -35.1 },
  { model: "qwen3.7-plus", input: 23.2, time: 4.2 },
];

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
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-dim sm:w-32">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <motion.div
          className="h-full rounded-full bg-glow"
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-glow">
        {pct.toFixed(1)}
      </span>
    </div>
  );
}

function Delta({ v, unit }: { v: number; unit: string }) {
  const good = v < 0;
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
        good ? "bg-glow/10 text-glow" : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {v > 0 ? "+" : "−"}
      {Math.abs(v).toFixed(1)}% {unit}
    </span>
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
      <div className="lift flex h-full flex-col rounded-lg border border-line bg-panel/60 p-6 hover:border-line-bright">
        <div className="flex items-center gap-3">
          <Icon className="size-5 shrink-0 text-glow" aria-hidden="true" />
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
    <section id="benchmarks" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
            Proof, not vibes
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Benchmarked where it hurts, including where it loses.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-dim">
            Official harnesses, pinned datasets, anti-tamper scoring, and per-task JSONL in
            the repo. The warm-memory panel below is published exactly as measured — two of
            three models used <em>more</em> input tokens with memory in the loop, and we
            left that in.
          </p>
        </FadeUp>

        {/* Full-bleed on purpose. Every other section runs inside the container;
            letting four numbers run edge to edge is the cheapest way to break a
            page that has started to feel like one long column. Dividers are
            borders on the cells rather than grid gaps, so the row spans the
            viewport without seam bars where the grid runs out. */}
        <div className="mt-12 border-y border-line bg-panel/30">
          <div className="mx-auto grid max-w-6xl px-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {[
              { v: "99.1%", l: "edit accuracy", s: "106-fixture oh-my-pi benchmark" },
              { v: "93.9%", l: "HumanEval+ pass@1", s: "official evalplus, greedy" },
              { v: "−35%", l: "warm wall time", s: "repeat tasks, kimi-k2.5" },
              { v: "4,585", l: "repo tests green", s: "pi monorepo, 0 failing" },
            ].map((s, i) => (
              <div
                key={s.l}
                className={`rise border-line py-8 sm:px-5 lg:border-l lg:first:border-l-0 ${i === 1 ? " sm:border-l" : ""}${i < 2 ? " border-b sm:border-b-0 lg:border-b-0" : ""}`}
              >
                <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-glow">
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
            icon={Target}
            name="Edit accuracy"
            source="oh-my-pi typescript-edit-benchmark · 106 fixtures · byte-exact scoring · full Unown agent in the loop"
          >
            {EDIT_BENCH.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <div className="mt-2 space-y-1.5 rounded-md border border-line bg-canvas/50 p-3">
              <p className="font-mono text-[10.5px] leading-relaxed text-dim">
                <span className="text-glow">head-to-head</span> against the oh-my-pi agent
                itself, same 106 fixtures, edit format pinned, 3 runs per task:{" "}
                <span className="text-ink">identical best-of-3 scores on every model</span>{" "}
                — and <span className="text-glow">2.4–5.4× fewer input tokens</span> per
                task.
              </p>
            </div>
          </TrackCard>

          <TrackCard
            icon={FlaskConical}
            name="HumanEval+"
            source="official evalplus CLI · sanitize → evaluate · pass@1 · greedy · 164 problems"
            delay={0.05}
          >
            {HUMANEVAL_PLUS.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <p className="mt-1 font-mono text-[10px] text-faint">
              base HumanEval, for reference: 98.8 / 97.0 / 97.6
            </p>
          </TrackCard>

          <TrackCard
            icon={Brain}
            name="Self-improvement, measured"
            source="10-task repeat set · cold vs warm, dreamed memory carried into fresh workspaces · 60/60 passed across six passes"
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
              A caching-only control in v1 faked −25.6%. We publish the real memory effect
              instead.
            </p>
          </TrackCard>

          <TrackCard
            icon={Layers}
            name="Aider polyglot subset"
            source="50-exercise stratified subset of Aider-AI/polyglot-benchmark · 6 languages · Aider's 2-attempt protocol · pass@2 shown"
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
              first published polyglot numbers for these models · 150 scored runs across
              three models
            </p>
          </TrackCard>
        </div>

        {/* methodology + what we did not do */}
        <FadeUp delay={0.08}>
          <div className="mt-6 grid gap-6 rounded-lg border border-line bg-panel/40 p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-glow">
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
                    d: "evalplus CLI, oh-my-pi's own edit benchmark, Aider's polyglot protocol — no home-rolled scoring.",
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

            <div className="rounded-md border border-line bg-canvas/50 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
                What we did not run
              </p>
              <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-dim">
                <li>
                  <span className="text-ink">SWE-bench Verified</span> and{" "}
                  <span className="text-ink">Terminal-Bench 2.0</span> are quoted from
                  vendor reports, not measured here.
                </li>
                <li>
                  Our own <span className="text-ink">extension-authoring eval</span> scores{" "}
                  <span className="text-ink">0.0</span> for every model. Reported as-is.
                </li>
              </ul>
              <a
                href={BENCH_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-glow underline-offset-4 hover:underline"
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