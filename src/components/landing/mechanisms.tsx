"use client";

import { ExternalLink } from "lucide-react";
import { FadeUp, GITHUB_URL } from "./shell";

const SRC = (file: string) => `${GITHUB_URL}/blob/main/pi-repo/packages/self-learning/src/${file}`;

/* ------------------------------------------------------------------ */
/* the problem                                                         */
/* ------------------------------------------------------------------ */

const PAINS = [
  {
    t: "You re-explain the same three things every morning.",
    d: "The conventions, the flaky test, the service that lies about being ready. Every session starts from zero and pays for the same context again.",
  },
  {
    t: "It fixed the bug by editing the test.",
    d: "Coding agents are fluent enough to make a suite green without making the software right. Passing tests are the only signal most loops have.",
  },
  {
    t: "You find out it learned the wrong thing three weeks later.",
    d: "Most memory systems are append-only. Nothing tells you who wrote a rule, when, or how to get back to the version before it.",
  },
];

/* ------------------------------------------------------------------ */
/* the five mechanisms                                                 */
/* ------------------------------------------------------------------ */

type Mechanism = {
  n: string;
  title: string;
  pain: string;
  body: string;
  proof: string;
  file: string;
  href: string;
};

const MECHANISMS: Mechanism[] = [
  {
    n: "01",
    title: "Tiered memory",
    pain: "re-explaining the project every session",
    body: "Four tiers — policy, project, user, local — resolved most-specific-wins and injected into every prompt. Engine sandboxes and terminal sessions get the same stack, re-read on /new, /resume and /fork so an AutoDream update lands without a restart.",
    proof: "Every write is versioned and attributed: seed · harness · autodream · manual · rollback.",
    file: "memory.ts",
    href: SRC("memory.ts"),
  },
  {
    n: "02",
    title: "Self-improving harness",
    pain: "it fixed the bug by editing the test",
    body: "A benchmark task runs in a fresh sandbox. If it fails, the transcript is mined for memory rules that would have prevented it, a candidate re-runs against the patched memory, and the patch ships only if a second independent run passes too. Shipped patches that later regress are un-shipped automatically.",
    proof: "The noise gate is the point: one passing run is a lucky run.",
    file: "harness.ts",
    href: SRC("harness.ts"),
  },
  {
    n: "03",
    title: "Routing",
    pain: "improvement only happens when you remember to run it",
    body: "Seven jobs keep the loop moving in the background: five on intervals — harness-cycle 10m, auto-dream 10m, note-sync 5m, task-mint 30m, sandbox-gc 15m — plus two on events, improvement:shipped and run:finished. A busy-mutex means the sandbox is never double-driven.",
    proof: "When the suite saturates, task minting authors harder curriculum variants from real failures.",
    file: "router.ts",
    href: SRC("router.ts"),
  },
  {
    n: "04",
    title: "AutoDreaming and skill acquisition",
    pain: "you find out it learned the wrong thing weeks later",
    body: "Session notes consolidate into project memory under a canary gate: the most recently passing task has to re-pass, or the dream rolls itself back. When notes keep describing the same multi-step procedure, AutoDream mints it as a real Agent Skill in .unown/skills/ — at most two per dream, deduped against everything already on disk.",
    proof: "The engine never deletes your files. Retirement is a deliberate dashboard action.",
    file: "dream.ts",
    href: SRC("dream.ts"),
  },
  {
    n: "05",
    title: "Hooks",
    pain: "it ran something it had no business running",
    body: "A pi extension enforcing guardrails at six layers: SessionStart, UserPromptSubmit, PreToolUse (deny-list plus a path jail), PostToolUse (a syntax gate that feeds the transpiler error straight back), Stop and SubagentStop. Every allow, deny and augment is written to a log.",
    proof: "Normal work stays allowed — network, git push, installs. UNOWN_STRICT_HOOKS=1 for sandbox-grade.",
    file: "hooks.ts",
    href: SRC("hooks.ts"),
  },
];

const INFRA = [
  {
    title: "OS-level sandbox",
    body: "Every engine run executes under bubblewrap — the foundation Flatpak and Claude Code use. Read-only root, private /home, /tmp and /run, so your repo, .env and engine data are invisible inside. Killed network namespace, dropped capabilities, sha256-pinned verification so the agent cannot edit the test.",
    file: "bwrap.ts",
    href: SRC("bwrap.ts"),
  },
  {
    title: "Mission control",
    body: "A dashboard that streams runs, cycles, dream journals, memory version history and hook decisions over SSE — and lets you roll any of them back.",
    file: "/dashboard",
    href: "/dashboard",
  },
];

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function MechanismsSection() {
  return (
    <section id="mechanisms" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        {/* the problem, stated plainly */}
        <FadeUp className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
            The problem
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            An agent that forgets is a tax you pay every morning.
          </h2>
        </FadeUp>

        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {PAINS.map((p, i) => (
            <FadeUp key={p.t} delay={i * 0.06} className="bg-panel p-6">
              <p className="text-[15px] font-medium leading-snug text-ink">{p.t}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-dim">{p.d}</p>
            </FadeUp>
          ))}
        </div>

        {/* the mechanisms, as rows rather than a grid of identical tiles */}
        <div className="mt-20">
          <FadeUp className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-glow">
              Five mechanisms
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              One answer to each of those.
            </h2>
          </FadeUp>

          <div className="mt-10">
            {MECHANISMS.map((m, i) => (
              <FadeUp key={m.n} delay={Math.min(i, 3) * 0.05}>
                <div className="group grid gap-4 border-t border-line py-8 lg:grid-cols-[2.5rem_minmax(0,17rem)_minmax(0,1fr)] lg:gap-6">
                  <p className="font-mono text-[11px] tabular-nums text-glow">{m.n}</p>

                  <div>
                    <h3 className="text-lg font-medium text-ink">{m.title}</h3>
                    <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                      {m.pain}
                    </p>
                    <a
                      href={m.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-glow underline-offset-4 hover:underline"
                    >
                      {m.file}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[14px] leading-relaxed text-dim">{m.body}</p>
                    <p className="mt-3 border-l border-line pl-3 text-[12.5px] leading-relaxed text-faint">
                      {m.proof}
                    </p>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>

        {/* infrastructure, labelled as such so the count stays honest */}
        <FadeUp className="mt-6">
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
            {INFRA.map((item) => (
              <div key={item.title} className="bg-panel p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-ink">{item.title}</h3>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                    infrastructure
                  </span>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-dim">{item.body}</p>
                <a
                  href={item.href}
                  {...(item.href.startsWith("http")
                    ? { target: "_blank", rel: "noreferrer noopener" }
                    : {})}
                  className="mt-3 inline-block font-mono text-[11px] text-glow underline-offset-4 hover:underline"
                >
                  {item.file}
                </a>
              </div>
            ))}
          </div>
        </FadeUp>
      </div>
    </section>
  );
}