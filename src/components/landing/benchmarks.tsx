"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Brain, ExternalLink, FlaskConical, Layers, ShieldCheck, Target } from "lucide-react";
import { FadeUp, BENCH_URL, SectionHead } from "./shell";

/**
 * Every number here comes from a real run with receipts committed under
 * `benchmarks/`. Measured 2026-10-16, greedy decoding, through the bundled
 * llm-bridge on Dashscope (kimi-k2.5 / qwen3.7-plus / qwen3.6-plus); tracks
 * re-verified from a fresh checkout on 2026-10-17 (evalplus + edit-bench
 * consts below carry the fresh numbers; per-track receipts under
 * benchmarks/<track>/results/rerun-2026-10-17/).
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

const POLYGLOT = [
  { model: "qwen3.6-plus", pct: 96, pass1: 96 },
  { model: "qwen3.7-plus", pct: 96, pass1: 96 },
  { model: "kimi-k2.5", pct: 94, pass1: 94 },
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
      className={`px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
        good ? "bg-glow/10 text-glow" : "bg-amber/10 text-amber"
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
      <div className="gb-panel lift flex h-full flex-col p-6 hover:border-line-bright" data-tone="amber">
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
          <SectionHead
            kicker="Proof, not vibes"
            tone="amber"
            lead={
              <>
                Official harnesses, pinned datasets, anti-tamper scoring, and per-task JSONL in
                the repo. The warm-memory panel below is published exactly as measured — two of
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
              { v: "98.1%", l: "edit accuracy", s: "106-fixture oh-my-pi benchmark" },
              { v: "93.9%", l: "HumanEval+ pass@1", s: "official evalplus, greedy" },
              { v: "−35%", l: "warm wall time", s: "repeat tasks, kimi-k2.5" },
              { v: "5,032", l: "repo tests green", s: "pi monorepo + engine, 0 failing" },
            ].map((s, i) => (
              <div
                key={s.l}
                className={`rise border-line py-8 sm:px-5 lg:border-l lg:first:border-l-0 ${i === 1 ? " sm:border-l" : ""}${i < 2 ? " border-b sm:border-b-0 lg:border-b-0" : ""}`}
              >
                <p className="gb-h text-3xl tabular-nums tracking-tight text-glow">
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
            source="oh-my-pi typescript-edit-benchmark · 106 fixtures · byte-exact scoring · full Unown agent in the loop · 2026-10-17 fresh-checkout rerun"
          >
            {EDIT_BENCH.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <div className="mt-2 space-y-1.5 border border-line bg-canvas/50 p-3">
              <p className="font-mono text-[10.5px] leading-relaxed text-dim">
                <span className="text-glow">head-to-head</span> against the oh-my-pi agent
                itself, same 106 fixtures, edit format pinned, 3 runs per task:{" "}
                <span className="text-ink">identical best-of-3 scores on every model</span>{" "}
                — and <span className="text-glow">2.4–5.4× fewer input tokens</span> per
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

        {/* The regression layer below the loop: tests that protect the harness
            while the agent rewrites itself. Numbers are the committed test
            suites — checkable by running them. */}
        <FadeUp delay={0.05}>
          <div className="mt-6 gb-panel p-6" data-tone="amber">
            <div className="flex flex-wrap items-center gap-3">
              <ShieldCheck className="size-5 shrink-0 text-glow" aria-hidden="true" />
              <h3 className="text-[15px] font-medium text-ink">
                The regression layer below the loop
              </h3>
              <span className="bg-glow/10 px-1.5 py-0.5 font-mono text-[10.5px] text-glow">
                641 harness tests · 0 fail
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-dim">
              A self-improving agent regresses its own harness first — a bad memory ship
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
                  d: "model routing, tool-call sanitizing, SSE stats folding, retry/backoff math — 6,197 assertions",
                },
                {
                  v: "384",
                  l: "engine unit tests",
                  d: "memory tiers + rollback, sha256 tamper gate, mint validation, busy-mutex, bwrap profile, hook corpus",
                },
              ].map((c) => (
                <div key={c.l} className="gb-inset p-4">
                  <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-glow">
                    {c.v}
                  </p>
                  <p className="mt-1 text-[13px] font-medium text-ink">{c.l}</p>
                  <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">{c.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10.5px] leading-relaxed text-faint">
              <span>
                <span className="text-glow">CI</span> lint · typecheck · unit · shell-syntax
                · theme — every push
              </span>
              <span>
                <span className="text-glow">hook corpus</span> 38 adversarial commands; the
                bypasses the corpus found (wrapped <span className="text-ink">rm -rf /</span>,
                <span className="text-ink"> $&#123;HOME&#125;</span> expansion, fork-bomb
                variants, numeric-IP egress, symlink jail escape) are closed and pinned
              </span>
              <span>
                <span className="text-glow">runs on</span> bun test · zero new dependencies
              </span>
            </div>
          </div>
        </FadeUp>

        {/* methodology + what we did not do */}
        <FadeUp delay={0.08}>
          <div className="mt-6 grid gap-6 gb-panel p-6 lg:grid-cols-[minmax(0,1fr)_18rem]" data-tone="amber">
            <div>
              <p className="gb-label text-[10px] text-glow">
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

            <div className="gb-box p-4" data-tone="amber">
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