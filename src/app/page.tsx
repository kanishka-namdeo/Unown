"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Box,
  Brain,
  Check,
  CheckCircle2,
  Copy,
  FlaskConical,
  Layers,
  LayoutDashboard,
  MoonStar,
  ShieldCheck,
  Sparkles,
  Target,
  TerminalSquare,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const GITHUB_URL = "https://github.com/kanishka-namdeo/Unown";
const DOCS_URL = "https://github.com/kanishka-namdeo/Unown/tree/main/docs";

/** lucide-react 1.x dropped brand icons, so inline the GitHub mark. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Fade-up on scroll; skips the y-offset when the user prefers reduced motion. */
function FadeUp({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <FadeUp className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-xs tracking-widest text-emerald-400">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {sub ? <p className="mt-4 text-zinc-400">{sub}</p> : null}
    </FadeUp>
  );
}

function TrafficDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="size-3 rounded-full bg-red-500/80" />
      <span className="size-3 rounded-full bg-amber-500/80" />
      <span className="size-3 rounded-full bg-emerald-500/80" />
    </div>
  );
}

/** Terminal-style window frame shared by the hero mockup and the quickstart block. */
function TerminalWindow({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 shadow-2xl">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="truncate font-mono text-xs text-zinc-500">{title}</span>
        </div>
        <div className="flex min-w-[28px] items-center justify-end gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** Browser-style frame for the dashboard screenshots. */
function BrowserFrame({
  url,
  src,
  alt,
}: {
  url: string;
  src: string;
  alt: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 shadow-xl transition-colors hover:border-zinc-700">
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="truncate rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-0.5 font-mono text-[11px] text-zinc-500">
            {url}
          </span>
        </div>
        <div className="min-w-[28px]" aria-hidden="true" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* nav                                                                 */
/* ------------------------------------------------------------------ */

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Unown logo" className="h-6 w-6" />
          <span className="text-lg font-semibold lowercase">unown</span>
          <span className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 min-[420px]:inline-block">
            self-improving
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-6 sm:flex">
          <a
            href="#how-it-works"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            How it works
          </a>
          <a
            href="#features"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            Features
          </a>
          <a
            href="#benchmarks"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            Benchmarks
          </a>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            Dashboard
          </Link>
          <a href="#faq" className="text-sm text-zinc-400 transition-colors hover:text-zinc-100">
            FAQ
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Unown on GitHub"
            className="inline-flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <GithubMark className="size-5" />
          </a>
          <a
            href="#quickstart"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* hero                                                                */
/* ------------------------------------------------------------------ */

const HERO_STATS = [
  "4-tier memory",
  "verify-gated harness",
  "OS-level sandbox",
  "any OpenAI-compatible model",
  "MIT licensed",
];

function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-16">
      {/* radial emerald glow, top-center */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-220px] h-[440px] w-[680px] -translate-x-1/2 rounded-full bg-emerald-900/20 blur-[110px]"
      />
      {/* faint grid pattern, fading out downwards */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(63,63,70,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(63,63,70,0.22)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_30%,transparent_100%)]"
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <FadeUp className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400">
            <Sparkles className="size-3.5 text-emerald-400" aria-hidden="true" />
            Open source · MIT · built on pi
          </span>
        </FadeUp>

        <FadeUp delay={0.05}>
          <h1 className="mx-auto mt-6 max-w-3xl text-center text-5xl font-bold tracking-tight md:text-7xl">
            The self-improving terminal agent.
          </h1>
        </FadeUp>

        <FadeUp delay={0.1}>
          <p className="mx-auto mt-6 max-w-2xl text-center text-lg text-zinc-400 md:text-xl">
            Unown pairs with you in the terminal, turns every session into a note, and dreams
            those notes into durable project memory — verified in a sandbox before anything
            ships.
          </p>
        </FadeUp>

        <FadeUp delay={0.15} className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#quickstart"
            className="rounded-lg bg-emerald-500 px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
          >
            Get started
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 text-base text-zinc-200 transition-colors hover:border-zinc-500"
          >
            <GithubMark className="size-5" />
            Star on GitHub
          </a>
        </FadeUp>

        <FadeUp delay={0.2} className="mx-auto mt-12 max-w-3xl">
          <TerminalWindow title="unown — session">
            <div className="p-5 font-mono text-sm leading-relaxed text-left sm:p-6">
              <p>
                <span className="text-emerald-400">$</span>{" "}
                <span className="text-zinc-100">unown &quot;why does the checkout test flake?&quot;</span>
              </p>
              <p className="text-zinc-500">✓ memory · 4 tiers · project v6 injected</p>
              <p className="text-zinc-500">⚡ read tests/checkout.spec.ts · src/checkout.ts</p>
              <p className="text-zinc-300">The flake: a shared cart fixture races in beforeEach.</p>
              <p className="text-zinc-300">Patched with an isolated fixture — 14/14 passing.</p>
              <p aria-hidden="true">&nbsp;</p>
              <p className="text-emerald-400">
                📝 session note queued — tonight&apos;s dream will consolidate it
                <span
                  aria-hidden="true"
                  className="unown-cursor ml-1 inline-block h-4 w-2.5 translate-y-[3px] bg-emerald-400"
                />
              </p>
            </div>
          </TerminalWindow>
        </FadeUp>

        <FadeUp delay={0.25}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-zinc-500">
            {HERO_STATS.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && (
                  <span aria-hidden="true" className="text-zinc-700">
                    ·
                  </span>
                )}
                <span>{s}</span>
              </React.Fragment>
            ))}
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the learning loop                                                   */
/* ------------------------------------------------------------------ */

const LOOP_STEPS = [
  {
    icon: TerminalSquare,
    title: "Work",
    desc: "Chat, plan and ship in your terminal — the real pi TUI, with tiered memory injected and guardrail hooks riding along in every session.",
  },
  {
    icon: Brain,
    title: "Learn",
    desc: "Each session leaves a note. The harness mines failures and proposes memory rules — a patch ships only after a fresh sandbox passes it twice.",
  },
  {
    icon: MoonStar,
    title: "Dream",
    desc: "Overnight, AutoDreaming consolidates notes into project memory and mints Agent Skills. Canary-gated: a dream that breaks anything rolls itself back.",
  },
];

function LoopSection() {
  return (
    <section id="how-it-works" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="THE LEARNING LOOP"
          title="Agents forget. Unown remembers."
          sub="Every other agent starts each session from zero. Unown runs a verify-gated learning loop that compounds — in your terminal and in the background engine."
        />

        <div className="mt-12 grid gap-6 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
          {LOOP_STEPS.map((step, i) => (
            <React.Fragment key={step.title}>
              {i > 0 && (
                <div
                  aria-hidden="true"
                  className="hidden items-center justify-center md:flex"
                >
                  <ArrowRight className="size-6 text-emerald-400" />
                </div>
              )}
              <FadeUp delay={i * 0.1}>
                <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-zinc-700">
                  <step.icon className="size-7 text-emerald-400" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{step.desc}</p>
                </div>
              </FadeUp>
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* features                                                            */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: Layers,
    title: "Tiered memory",
    desc: "Policy → project → user → local, merged most-specific-wins and injected into every session. Versioned, attributable, rollback-able.",
  },
  {
    icon: MoonStar,
    title: "AutoDreaming",
    desc: "Session notes consolidate into durable memory and Agent Skills while you sleep — canary-gated with automatic rollback.",
  },
  {
    icon: FlaskConical,
    title: "Self-improving harness",
    desc: "Runs the suite, mines failures, proposes memory patches — and ships them only when a fresh sandbox verifies them twice.",
  },
  {
    icon: ShieldCheck,
    title: "Hooks & guardrails",
    desc: "Six hook layers: command deny-lists, a path jail, and a syntax gate that feeds errors straight back to the agent.",
  },
  {
    icon: Box,
    title: "OS-level sandbox",
    desc: "Every engine run executes under bubblewrap: read-only root, private /tmp, no network. The same foundation Flatpak uses.",
  },
  {
    icon: LayoutDashboard,
    title: "Mission control",
    desc: "Live activity, run transcripts, dream journals, hook decisions — full observability of what your agent learned.",
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-16 bg-zinc-900/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="MECHANISMS"
          title="An agent that actually sticks around."
          sub="Six mechanisms, one loop — each observable from the dashboard."
        />

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={(i % 3) * 0.08}>
              <div className="h-full rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 transition-colors hover:border-zinc-700">
                <f.icon className="size-7 text-emerald-400" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.desc}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* dashboard showcase                                                  */
/* ------------------------------------------------------------------ */

function ShowcaseSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="MISSION CONTROL"
          title="Watch it learn."
          sub="The dashboard streams everything live over SSE — runs, dreams, notes and hook decisions."
        />

        <FadeUp className="mx-auto mt-12 max-w-5xl">
          <BrowserFrame
            url="localhost:3000/dashboard"
            src="/landing/dash-overview.png"
            alt="Unown mission-control dashboard — overview with KPIs, cumulative passes and live activity"
          />
          <p className="mt-3 text-center font-mono text-xs text-zinc-500">
            Real dashboard, real engine data — captured from a live run.
          </p>
        </FadeUp>

        <div className="mx-auto mt-6 grid max-w-5xl gap-6 md:grid-cols-2">
          <FadeUp delay={0.05}>
            <BrowserFrame
              url="localhost:3000/dashboard"
              src="/landing/dash-learning-lab.png"
              alt="Learning Lab — harness cycles, improvements and runs"
            />
          </FadeUp>
          <FadeUp delay={0.1}>
            <BrowserFrame
              url="localhost:3000/dashboard"
              src="/landing/dash-hooks.png"
              alt="Hooks — six guardrail layers and the decision log"
            />
          </FadeUp>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* any model                                                           */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  "Dashscope",
  "OpenAI",
  "Anthropic",
  "OpenRouter",
  "DeepSeek",
  "vLLM",
  "Ollama",
  "llama.cpp",
];

function ModelsSection() {
  return (
    <section className="bg-zinc-900/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="MODEL AGNOSTIC"
          title="Bring your own brain."
          sub="Any OpenAI-compatible endpoint works — the bundled bridge handles routing, auth and streaming."
        />

        <FadeUp className="mt-10">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {PROVIDERS.map((p) => (
              <span
                key={p}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-2 font-mono text-sm text-zinc-300 transition-colors hover:border-zinc-700"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="mt-6 text-center font-mono text-sm text-zinc-500">
            unown setup --provider dashscope --api-key sk-... --model kimi-k2.5
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* benchmarks                                                          */
/* ------------------------------------------------------------------ */

/**
 * All numbers are real, reproducible runs through the local llm-bridge
 * (Dashscope: kimi-k2.5 / qwen3.7-plus / qwen3.6-plus). Receipts live in
 * benchmarks/ in the repo. Update these consts when new runs land.
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

/**
 * Repeat-task efficiency, cold vs warm (fresh memory vs dreamed memory in
 * the loop) — v2 protocol, agent-authored notes. input = input-token delta,
 * time = wall-time delta; negative time = faster warm. Published as
 * measured, including the regressions.
 */
const SELFIMPROVE = [
  { model: "qwen3.6-plus", input: -23.7, time: -8.0 },
  { model: "kimi-k2.5", input: 21.8, time: -35.1 },
  { model: "qwen3.7-plus", input: 23.2, time: 4.2 },
];

const POLYGLOT_RESULTS = [
  { model: "qwen3.6-plus", pct: 100.0 },
  { model: "kimi-k2.5", pct: 98.0 },
  { model: "qwen3.7-plus", pct: 98.0 },
];

function BarRow({
  label,
  pct,
  delay = 0,
  muted = false,
}: {
  label: string;
  pct: number;
  delay?: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-zinc-400 sm:w-32">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
        <motion.div
          className={`h-full rounded-full ${muted ? "bg-zinc-500" : "bg-emerald-500"}`}
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
        />
      </div>
      <span
        className={`w-12 shrink-0 text-right font-mono text-sm ${
          muted ? "text-zinc-400" : "text-emerald-400"
        }`}
      >
        {pct.toFixed(1)}
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
      <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 transition-colors hover:border-zinc-700">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon className="size-6 text-emerald-400" aria-hidden="true" />
            <h3 className="text-base font-semibold">{name}</h3>
          </div>
        </div>
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-zinc-500">{source}</p>
        <div className="mt-5 flex flex-1 flex-col justify-center gap-3">{children}</div>
      </div>
    </FadeUp>
  );
}

function BenchmarksSection() {
  return (
    <section id="benchmarks" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="PROOF, NOT VIBES"
          title="Benchmarked where it hurts."
          sub="Official harnesses, pinned datasets, anti-tamper scoring — every number below is a real run with receipts committed to the repo."
        />

        {/* headline stats */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { v: "99.1%", l: "best edit accuracy", s: "106-fixture oh-my-pi edit benchmark" },
            { v: "93.9%", l: "HumanEval+ pass@1", s: "official evalplus, greedy decoding" },
            { v: "−35%", l: "warm wall time", s: "repeat tasks, memory in the loop (kimi)" },
            { v: "4,585", l: "repo tests green", s: "pi coding-agent monorepo suite" },
          ].map((s, i) => (
            <FadeUp key={s.l} delay={i * 0.06}>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-center">
                <p className="font-mono text-3xl font-bold text-emerald-400">{s.v}</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">{s.l}</p>
                <p className="mt-1 text-xs text-zinc-500">{s.s}</p>
              </div>
            </FadeUp>
          ))}
        </div>

        {/* tracks */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TrackCard
            icon={Target}
            name="Edit accuracy"
            source="oh-my-pi's typescript-edit-benchmark — 106 fixtures, byte-exact scoring, full Unown agent in the loop"
          >
            {EDIT_BENCH.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              % of edits applied exactly as intended · 3 models × 106 fixtures
            </p>
            <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3">
              <p className="font-mono text-[11px] leading-relaxed text-zinc-400">
                <span className="text-emerald-400">head-to-head</span> vs the
                oh-my-pi agent itself (edit format pinned, identical 106
                fixtures): task success 98.8% vs 97.8% — parity within noise —
                at <span className="text-emerald-400">1.7–3.1× fewer input
                tokens</span> per task.
              </p>
              <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
                omp&apos;s default hashline edits: 71–80% edit-call success;
                replace-style edits (both agents): 96–100%.
              </p>
            </div>
          </TrackCard>

          <TrackCard
            icon={FlaskConical}
            name="HumanEval+"
            source="official evalplus CLI (sanitize → evaluate), pass@1, greedy, 164 problems"
            delay={0.05}
          >
            {HUMANEVAL_PLUS.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              pass@1 on the extended (Plus) test suite
            </p>
          </TrackCard>

          <TrackCard
            icon={Brain}
            name="Self-improvement, measured"
            source="10-task repeat set · cold vs warm with dreamed memory carried into fresh workspaces · 60/60 tasks passed across all six passes"
            delay={0.1}
          >
            {SELFIMPROVE.map((r) => (
              <div key={r.model} className="flex items-center justify-between gap-3">
                <span className="w-28 shrink-0 truncate font-mono text-xs text-zinc-400 sm:w-32">
                  {r.model}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 font-mono text-sm ${
                    r.input < 0
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}
                >
                  {r.input > 0 ? "+" : "−"}
                  {Math.abs(r.input).toFixed(1)}% input
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 font-mono text-sm ${
                    r.time < 0
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}
                >
                  {r.time > 0 ? "+" : "−"}
                  {Math.abs(r.time).toFixed(1)}% time
                </span>
              </div>
            ))}
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              A caching-only control (v1) faked −25.6% — we publish the real
              memory effect instead, regressions included
            </p>
          </TrackCard>

          <TrackCard
            icon={Layers}
            name="Aider polyglot subset"
            source="50-exercise stratified subset of Aider-AI/polyglot-benchmark — 6 languages, Aider's 2-attempt protocol, anti-tamper scoring · pass@2 shown, pass@1: 94–96%"
            delay={0.15}
          >
            {POLYGLOT_RESULTS.map((r, i) => (
              <BarRow key={r.model} label={r.model} pct={r.pct} delay={i * 0.1} />
            ))}
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              first published polyglot numbers for these models · 150/150 exercises scored, zero harness errors
            </p>
          </TrackCard>
        </div>

        {/* methodology strip */}
        <FadeUp delay={0.1}>
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
            <p className="font-mono text-xs tracking-widest text-emerald-400">METHODOLOGY</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  t: "Anti-tamper scoring",
                  d: "Tests restored to pristine state before scoring; reference solutions never enter the agent workspace.",
                },
                {
                  t: "Pinned everything",
                  d: "Dataset commits, model catalog snapshots and harness versions are pinned and committed.",
                },
                {
                  t: "Official harnesses",
                  d: "evalplus CLI, oh-my-pi's own edit benchmark, Aider's polyglot protocol — no home-rolled scoring.",
                },
                {
                  t: "Receipts in the repo",
                  d: "Per-task JSONL with tokens, durations and outcomes for every single run lives in benchmarks/.",
                },
              ].map((m) => (
                <div key={m.t}>
                  <p className="text-sm font-semibold text-zinc-200">{m.t}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{m.d}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm text-zinc-400">
              Full write-up, fairness rules and raw results:{" "}
              <a
                href={`${GITHUB_URL}/tree/main/benchmarks`}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-emerald-400 underline-offset-4 hover:underline"
              >
                benchmarks/ in the repo
              </a>
            </p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* safety                                                              */
/* ------------------------------------------------------------------ */

const SAFETY_ROWS = [
  { text: "Every engine run sandboxed under bubblewrap — read-only root, no network", tag: "os" },
  { text: "Every dream canary-gated: breaks the last-passing task → auto-rollback", tag: "canary" },
  { text: "Memory patches ship only after a fresh sandbox verifies them twice", tag: "verify ×2" },
  { text: "Shipped patches that regress are automatically un-shipped", tag: "retention" },
  { text: "Every memory write versioned, attributable and rollback-able", tag: "versioned" },
];

function SafetySection() {
  return (
    <section id="safety" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader
          eyebrow="INTEGRITY"
          title="Learning with seatbelts."
          sub="A self-modifying agent needs gates. Unown's are on by default."
        />

        <FadeUp className="mx-auto mt-10 max-w-3xl">
          <ul>
            {SAFETY_ROWS.map((row) => (
              <li
                key={row.tag}
                className="flex items-center justify-between gap-4 border-b border-zinc-800/60 py-3"
              >
                <span className="flex items-center gap-3 text-zinc-300">
                  <CheckCircle2
                    className="size-5 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  />
                  {row.text}
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">{row.tag}</span>
              </li>
            ))}
          </ul>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* quickstart                                                          */
/* ------------------------------------------------------------------ */

const QUICKSTART = [
  "git clone https://github.com/kanishka-namdeo/Unown.git",
  "cd Unown",
  "bun run agent:install     # deps + pi build + .env",
  "unown setup               # connect any model",
  "unown                     # first session — memory on",
];

const quickstartLines = QUICKSTART.map((line) => {
  const hash = line.indexOf("#");
  if (hash === -1) return { cmd: line, comment: "" };
  return { cmd: line.slice(0, hash), comment: line.slice(hash) };
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fall back.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy install commands to clipboard"}
      className="inline-flex size-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/60 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

function QuickstartSection() {
  return (
    <section id="quickstart" className="scroll-mt-16 bg-zinc-900/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader eyebrow="QUICKSTART" title="Five minutes to a smarter terminal." />

        <FadeUp className="mx-auto mt-10 max-w-2xl">
          <TerminalWindow
            title="unown — quickstart"
            actions={<CopyButton text={QUICKSTART.join("\n")} />}
          >
            <div className="p-5 font-mono text-sm leading-relaxed text-left">
              {quickstartLines.map((line, i) => (
                <div key={i} className="whitespace-pre">
                  <span className="text-zinc-200">{line.cmd}</span>
                  {line.comment ? <span className="text-zinc-600">{line.comment}</span> : null}
                </div>
              ))}
            </div>
          </TerminalWindow>
          <p className="mt-4 text-center text-xs text-zinc-500">
            bun ≥ 1.2 · Linux or macOS (bubblewrap sandboxing is Linux-only; everything else
            works everywhere)
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQ = [
  {
    q: "Does it send my code anywhere?",
    a: "Only to the model endpoint you configure. Unown itself collects nothing — the engine, bridge and dashboard all run locally.",
  },
  {
    q: "Which models does it work with?",
    a: "Any OpenAI-compatible endpoint: Dashscope, OpenAI, Anthropic, OpenRouter, DeepSeek, or a local vLLM / Ollama / llama.cpp server. The bundled bridge routes model ids, injects auth and streams SSE.",
  },
  {
    q: "What if a dream makes things worse?",
    a: "Every dream runs a canary benchmark first. If the last-passing task fails under the new memory, the dream rolls back automatically — and shipped patches that later regress get un-shipped.",
  },
  {
    q: "Is it safe to run on my repo?",
    a: "Engine runs execute in a bubblewrap sandbox: read-only root filesystem, private /tmp, no network. Terminal sessions add guardrail hooks — deny-lists for sudo and force-pushes, plus a path jail.",
  },
  {
    q: "What is it built on?",
    a: "The open-source pi coding agent by Mario Zechner, wrapped in a self-learning layer. MIT licensed, end to end.",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeader eyebrow="FAQ" title="The skeptic's questions." />

        <FadeUp className="mx-auto mt-10 max-w-3xl">
          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item) => (
              <AccordionItem key={item.q} value={item.q} className="border-zinc-800">
                <AccordionTrigger className="text-left text-base font-medium text-zinc-100 hover:no-underline hover:text-emerald-300">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-zinc-400">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </FadeUp>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* final CTA + footer                                                  */
/* ------------------------------------------------------------------ */

function FinalCta() {
  return (
    <section className="relative overflow-hidden py-24 text-center">
      {/* radial emerald glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[380px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-900/20 blur-[110px]"
      />
      <div className="relative mx-auto max-w-6xl px-6">
        <FadeUp>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Stop re-explaining your codebase.
          </h2>
          <p className="mt-4 text-zinc-400">Clone it. Chat. Come back smarter.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#quickstart"
              className="rounded-lg bg-emerald-500 px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
            >
              Get started
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 text-base text-zinc-200 transition-colors hover:border-zinc-500"
            >
              <GithubMark className="size-5" />
              GitHub
            </a>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/60 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="h-5 w-5" />
            <span className="text-sm text-zinc-500">
              unown — the self-improving terminal agent
            </span>
          </div>
          <nav aria-label="Footer" className="flex items-center gap-6">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
              GitHub
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Documentation
            </a>
            <Link
              href="/dashboard"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Dashboard
            </Link>
          </nav>
        </div>
        <p className="mt-6 text-xs text-zinc-600">Built on the pi coding agent · MIT Licensed</p>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <style
        dangerouslySetInnerHTML={{
          __html: `
html { scroll-behavior: smooth; }
@keyframes unown-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.unown-cursor { animation: unown-blink 1.1s step-end infinite; }
`,
        }}
      />
      <Nav />
      <main className="flex-1 bg-zinc-950 text-zinc-100">
        <Hero />
        <LoopSection />
        <FeaturesSection />
        <ShowcaseSection />
        <ModelsSection />
        <BenchmarksSection />
        <SafetySection />
        <QuickstartSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
