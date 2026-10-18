"use client";

import { ExternalLink } from "lucide-react";
import { FadeUp, GITHUB_URL, SectionHead } from "./shell";

const SRC = (file: string) => `${GITHUB_URL}/blob/main/pi-repo/packages/self-learning/src/${file}`;

/* ------------------------------------------------------------------ */
/* the problem                                                         */
/* ------------------------------------------------------------------ */

const PAINS = [
  {
    t: "You re-explain the same three things each time you sit down.",
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
    body: "Four tiers: policy, project, user, local. Most-specific-wins, injected into every prompt. Engine sandboxes and terminal sessions get the same stack, re-read on /new, /resume and /fork so an AutoDream update lands without a restart.",
    proof: "Every write is versioned and attributed: seed · harness · autodream · manual · rollback.",
    file: "memory.ts",
    href: SRC("memory.ts"),
  },
  {
    n: "02",
    title: "Self-improving harness",
    pain: "it fixed the bug by editing the test",
    body: "A benchmark task runs in a fresh sandbox. If it fails, the transcript is mined for memory rules that would have prevented it, and a candidate re-runs against the patched memory.",
    proof: "The engine log records both runs: candidate, then confirmation.",
    file: "harness.ts",
    href: SRC("harness.ts"),
  },
  {
    n: "03",
    title: "Routing",
    pain: "improvement only happens when you remember to run it",
    body: "Seven jobs keep the loop moving in the background without you: five on a timer, two on events. A busy-mutex means the sandbox is never double-driven.",
    proof: "When the suite saturates, task minting authors harder curriculum variants from real failures.",
    file: "router.ts",
    href: SRC("router.ts"),
  },
  {
    n: "04",
    title: "AutoDreaming and skill acquisition",
    pain: "you find out it learned the wrong thing weeks later",
    body: "Session notes consolidate into project memory, and a procedure that keeps recurring gets minted as a real Agent Skill in .unown/skills/ so the next session starts with it instead of rediscovering it.",
    proof: "The engine never deletes your files. Retirement is a deliberate dashboard action.",
    file: "dream.ts",
    href: SRC("dream.ts"),
  },
  {
    n: "05",
    title: "Hooks",
    pain: "it ran something it had no business running",
    body: "A pi extension enforcing guardrails at six layers: before the prompt, before and after every tool call, and at the end of the session and of each subagent. Every allow, deny and augment is written to a log.",
    proof: "Normal work stays allowed: network, git push, installs. UNOWN_STRICT_HOOKS=1 for sandbox-grade.",
    file: "hooks.ts",
    href: SRC("hooks.ts"),
  },
];

const INFRA = [
  {
    title: "OS-level sandbox",
    // Only the Flatpak/Claude Code comparison — the containment claim itself is
    // integrity.tsx's, in both its layers.
    body: "bubblewrap, the same sandboxing Flatpak and Claude Code use.",
    file: "bwrap.ts",
    href: SRC("bwrap.ts"),
  },
  {
    title: "The dashboard",
    body: "Runs, cycles, dreams and memory versions stream live, and any of them roll back in one click.",
    file: "see it in screenshots",
    href: "#showcase",
  },
];

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function MechanismsSection() {
  return (
    <section data-hue="magma" id="mechanisms" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        {/* the problem, stated plainly */}
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The problem">
            What goes wrong without persistent memory.
          </SectionHead>
        </FadeUp>

        <div className="mt-10 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">
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
            <SectionHead kicker="Five mechanisms">
              Three pains, five answers.
            </SectionHead>
          </FadeUp>

          <div className="mt-10">
            {MECHANISMS.map((m, i) => (
              <FadeUp key={m.n} delay={Math.min(i, 3) * 0.05}>
                <div className="group grid gap-4 border-t border-line py-8 lg:grid-cols-[2.5rem_minmax(0,17rem)_minmax(0,1fr)] lg:gap-6">
                  <p className="gb-label text-[10px] tabular-nums text-gold">{m.n}</p>

                  <div>
                    <h3 className="text-lg font-medium text-ink">{m.title}</h3>
                    <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                      {m.pain}
                    </p>
                    <a
                      href={m.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-gold underline-offset-4 hover:underline"
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
          <div className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
            {INFRA.map((item) => (
              <div key={item.title} className="bg-panel p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-ink">{item.title}</h3>
                  <span className="gb-label text-[8px] text-faint">
                    infrastructure
                  </span>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-dim">{item.body}</p>
                <a
                  href={item.href}
                  {...(item.href.startsWith("http")
                    ? { target: "_blank", rel: "noreferrer noopener" }
                    : {})}
                  className="mt-3 inline-block font-mono text-[11px] text-gold underline-offset-4 hover:underline"
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