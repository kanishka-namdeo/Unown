"use client";

import { motion } from "framer-motion";
import { FadeUp, GITHUB_URL, BENCH_URL } from "./shell";

/**
 * The Integrity pane of the proof band (`proof.tsx`).
 *
 * The LOG rows below are literals the engine writes, taken from `hooks.ts`,
 * `harness.ts` or (the deny reasons' author) `instruction-guard.ts`, with the
 * interpolated ids and versions filled in —
 * `scripts/landing_claims.mjs` asserts each literal against its source file,
 * so a deny rule reworded turns the page red rather than making it quietly
 * wrong. The six hook names here are the six members of `HookName`.
 *
 * 2026-10-20 compression: the gates list kept all seven rows with one-line
 * descriptions. The same day's detached-engine round added the eighth —
 * unattended discipline — plus its receipts link. Nothing gated was touched.
 * 2026-10-22 hardening: two more deny rows — the instruction-set write gate
 * and the DNS-exfiltration family — and the sandbox paragraph gained the
 * same two denials in prose. Nothing pre-existing was re-worded.
 * 2026-10-22 v2 (memory-lane): a third deny row — the Manual-notes
 * persistence channel (project memory + its provenance sidecar). Nothing
 * pre-existing was re-worded.
 */

const SRC = (file: string) => `${GITHUB_URL}/blob/main/pi-repo/packages/self-learning/src/${file}`;
const RECEIPTS: [string, string][] = [
  ["SECURITY.md", `${GITHUB_URL}/blob/main/SECURITY.md`],
  ["the threat model", `${GITHUB_URL}/blob/main/SECURITY.md#agent-threat-surface`],
  ["sandbox profile", SRC("bwrap.ts")],
  ["hook layer", SRC("hooks.ts")],
  ["config trust gate", SRC("config-trust.ts")],
  [
    "detached-engine receipts",
    `${GITHUB_URL}/blob/main/benchmarks/detached-engine/RESULTS.md`,
  ],
];

/* ------------------------------------------------------------------ */
/* the gates                                                           */
/* ------------------------------------------------------------------ */

const GATES = [
  {
    t: "Ship gate",
    d: "A mined patch enters memory only after a candidate run passes in a fresh sandbox, and the pass replicates in a second, independent confirmation run.",
    tag: "verify ×2",
  },
  {
    t: "Content guard",
    d: "A deterministic adversarial-content scan runs at the ship step and on both dream paths — clean ships, partly flagged ships quarantined, mostly adversarial gates entirely.",
    tag: "ship · sanitize · gate",
  },
  {
    t: "Mint gate",
    d: "A minted task becomes an active capability eval only once a real sandboxed run genuinely fails it.",
    tag: "fail first",
  },
  {
    t: "Dream canary",
    d: "A consolidation must re-pass the most recently passing task; a dream that breaks it rolls itself back and is logged as gated.",
    tag: "rolled back to v5",
  },
  {
    t: "Retention check",
    d: "If a task fails again after its improvement shipped, the improvement is un-shipped to the pre-ship version.",
    tag: "auto-unship",
  },
  {
    t: "Skill mint gate",
    d: "Skills mint only from recurring multi-step procedures, capped at two per dream, validated against the Agent Skills contract and deduped — and they land in a staging directory no session loads until a human promotes them.",
    tag: "max 2 / dream",
  },
  {
    t: "Full version history",
    d: "Every write to every tier is versioned and attributable; engine tiers and skills roll back from the dashboard, project memory is plain versioned Markdown you diff yourself.",
    tag: "rollback-able",
  },
  {
    t: "Unattended discipline",
    d: "The engine keeps its own books: hourly and daily call + token ceilings on LLM spend, an exponential backoff breaker for a failing upstream, and a watchdog that frees any stuck job — every skip is logged with its reason.",
    tag: "budget · breaker · watchdog",
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
  ["PreToolUse", "deny", "network access to external hosts is denied in the sandbox"],
  ["PreToolUse", "deny", "DNS-capable commands to external hosts are denied in the sandbox (exfiltration channel)"],
  [
    "PreToolUse",
    "deny",
    "instruction-set file is not writable in-session: .unown/hooks.json (propose changes via a PR for human review)",
  ],
  [
    "PreToolUse",
    "deny",
    "instruction-set file is not writable in-session: .unown/memory/project.md (memory is engine-written — add Manual notes by editing the file outside a session; dreams preserve them verbatim)",
  ],
  [
    "SubagentStop",
    "log",
    "candidate 8f21c0a3 + confirmation both passed — patch shipped to project memory (v7)",
  ],
  ["Stop", "log", "agent loop ended after 12 messages"],
] as const;

const DECISION_TONE: Record<string, string> = {
  log: "text-faint",
  allow: "text-gold-soft",
  augment: "text-amber",
  deny: "text-poke",
};

/* ------------------------------------------------------------------ */
/* the pane                                                            */
/* ------------------------------------------------------------------ */

export function IntegrityPane() {
  return (
    <div data-hue="magma" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-12">
      {/* gates */}
      <FadeUp>
        <ul className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
          {GATES.map((g) => (
            <li key={g.t} className="bg-panel p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[14px] font-medium text-ink">{g.t}</h3>
                <span className="gb-label shrink-0 border border-line bg-canvas/60 px-2 py-0.5 text-[8px] text-gold">
                  {g.tag}
                </span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-dim">{g.d}</p>
            </li>
          ))}
        </ul>

        {/* the admission — a gate that says no and refuses to negotiate */}
        <div className="gb-box mt-5 p-5" data-tone="magma">
          <p className="gb-label text-[10px] text-canvas">
            And one eval we report at zero
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-canvas">
            Our own{" "}
            <a
              href={BENCH_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline underline-offset-2"
            >
              extension-authoring eval
            </a>{" "}
            scores <span className="font-medium">0.0</span> for every model. Reported as-is.
          </p>
        </div>

        {/* sandboxes + config trust, one block */}
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-sm font-medium text-ink">Sandboxes, two layers</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
            Every engine run and the agent&apos;s own bash execute under bubblewrap with
            a read-only root and private <span className="font-mono text-ink">/home
            /tmp /run</span> — your repo, your{" "}
            <span className="font-mono text-ink">.env</span> and the engine database are
            not visible from inside, and the network namespace is killed (Seatbelt on
            macOS, in-process jail on Windows). Terminal sessions stay scoped for real
            work instead: root deletion, fork bombs and writes outside the project are
            refused, the agent&apos;s own rule files — AGENTS.md, .unown/skills, the hook
            and permission configs — are not writable in-session (changes go through
            a PR), and DNS-capable lookups to external hosts are denied in sandbox and
            strict modes, while network, <span className="font-mono">git push</span> and
            installs stay available (<span className="font-mono text-ink">UNOWN_STRICT_HOOKS=1</span>{" "}
            restores sandbox-grade). Cloned project-scoped MCP/LSP configs are
            trust-gated with pinned fingerprints, so a repo you just cloned cannot
            execute through the files it ships.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
          <span className="gb-label text-[9px] text-gold">Read the receipts</span>
          {RECEIPTS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[11.5px] text-gold underline-offset-4 hover:underline"
            >
              {label}
            </a>
          ))}
        </div>
      </FadeUp>

      {/* the log */}
      <FadeUp delay={0.1}>
        <div className="gb-panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2">
            <span className="size-1.5 bg-line-bright" aria-hidden="true" />
            <span className="gb-term text-[17px] text-faint">
              hook_log — six layers, every decision recorded
            </span>
          </div>
          <div className="divide-y divide-line/70">
            {LOG.map(([hook, decision, reason], i) => (
              <motion.div
                key={`${hook}-${reason}`}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.22, delay: i * 0.07 }}
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
              </motion.div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-faint">
          Every reason above is a literal the engine writes — deny lines, the
          syntax-gate augment and the ship decision come from real runs, and the
          gate re-checks them against the source on every push.
        </p>
      </FadeUp>
    </div>
  );
}
