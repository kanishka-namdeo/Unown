"use client";

import { FadeUp, SectionHead } from "./shell";

/* ------------------------------------------------------------------ */
/* the gates                                                           */
/* ------------------------------------------------------------------ */

const GATES = [
  {
    t: "Ship gate",
    d: "A mined patch enters memory only after a candidate run passes verification in a fresh sandbox, and the pass replicates in a second, independent confirmation run.",
    tag: "verify ×2",
  },
  {
    t: "Mint gate",
    d: "A minted task becomes an active capability eval only once a real sandboxed run genuinely fails it. Tasks the model already solves are discarded honestly.",
    tag: "fail first",
  },
  {
    t: "Dream canary",
    d: "A consolidation of project memory must re-pass the most recently passing task. A dream that breaks it rolls itself back and is logged as gated.",
    tag: "rolled back to v5",
  },
  {
    t: "Retention check",
    d: "If a task fails again after its improvement shipped, the improvement is marked regressed and memory is un-shipped to the pre-ship version.",
    tag: "auto-unship",
  },
  {
    t: "Skill mint gate",
    d: "Skills are minted only from recurring multi-step procedures, capped at two per dream, validated against the Agent Skills contract and deduped against everything on disk.",
    tag: "max 2 / dream",
  },
  {
    t: "Full version history",
    d: "Every write to every tier is versioned and attributable. Engine tiers and minted skills roll back from the dashboard; project memory is plain versioned Markdown you diff yourself.",
    tag: "rollback-able",
  },
];

/* ------------------------------------------------------------------ */
/* the real decision log                                               */
/* ------------------------------------------------------------------ */

const LOG = [
  ["SessionStart", "log", "session started (memory v6)"],
  ["UserPromptSubmit", "log", "prompt submitted: “why does checkout.spec flake…?”"],
  ["PreToolUse", "allow", "allowed"],
  ["PostToolUse", "augment", "syntax gate flagged src/checkout.spec.ts"],
  ["PreToolUse", "deny", "refusing rm on filesystem root"],
  ["PreToolUse", "deny", "network access to external hosts is denied"],
  ["Stop", "log", "session ended · note queued → engine"],
] as const;

const DECISION_TONE: Record<string, string> = {
  log: "text-faint",
  allow: "text-gold-soft",
  augment: "text-amber",
  deny: "text-poke",
};

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function IntegritySection() {
  return (
    <section data-hue="magma" id="integrity" className="scroll-mt-16 border-y border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="Integrity"
            lead={
              <>
                So every memory write is behind a gate, and every gate is visible from the
                dashboard with the run that proved it. It is the objection this project has to
                win, so it gets the whole section.
              </>
            }
          >
            Self-modification without gates degenerates fast.
          </SectionHead>
        </FadeUp>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-14">
          {/* gates */}
          <FadeUp>
            <ul className="border-t border-line">
              {GATES.map((g) => (
                <li
                  key={g.t}
                  className="grid gap-2 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6"
                >
                  <div>
                    <h3 className="text-[15px] font-medium text-ink">{g.t}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{g.d}</p>
                  </div>
                  <span className="gb-label self-start border border-line bg-canvas/60 px-2 py-0.5 text-[9px] text-gold sm:justify-self-end">
                    {g.tag}
                  </span>
                </li>
              ))}
            </ul>
          </FadeUp>

          {/* the log */}
          <FadeUp delay={0.1}>
            <div className="gb-panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2">
                <span className="size-1.5 rounded-full bg-line-bright" aria-hidden="true" />
                <span className="gb-term text-[17px] text-faint">
                  hook_log — six layers, every decision recorded
                </span>
              </div>
              <div className="divide-y divide-line/70">
                {LOG.map(([hook, decision, reason]) => (
                  <div
                    key={`${hook}-${reason}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5"
                  >
                    <span className="w-36 shrink-0 gb-term text-[17px] text-ink">
                      {hook}
                    </span>
                    <span
                      className={`w-16 shrink-0 gb-term text-[17px] ${
                        DECISION_TONE[decision]
                      }`}
                    >
                      {decision}
                    </span>
                    <span className="min-w-0 flex-1 gb-term text-[17px] leading-relaxed text-dim">
                      {reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-ink">Sandboxes, two layers</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-dim">
                  Every engine run, the verification scripts and the agent&apos;s own
                  bash alike,
                  executes under bubblewrap with a read-only root and private{" "}
                  <span className="font-mono text-ink">/home /tmp /run</span>. Your repo,
                  your <span className="font-mono text-ink">.env</span> and the engine
                  database are not visible from inside. The network namespace is killed and
                  capabilities are dropped. A vendored bwrap binary with recorded sha256
                  provenance means this works even where bubblewrap is not installed; hosts
                  without it fall back to the in-process path jail.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-ink">Terminal sessions stay useful</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-dim">
                  The engine sandbox blocks <span className="font-mono">sudo</span> and
                  outbound calls outright. Your terminal sessions are scoped for real work
                  instead: filesystem-root deletion, fork bombs and disk formats are
                  blocked, writes outside the project are refused, and network,{" "}
                  <span className="font-mono">git push</span> and package installs stay
                  available. <span className="font-mono text-ink">UNOWN_STRICT_HOOKS=1</span>{" "}
                  restores sandbox-grade strictness.
                </p>
              </div>
            </div>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}