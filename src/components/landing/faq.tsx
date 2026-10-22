"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FadeUp, PixelCursor, SectionHead } from "./shell";

/**
 * The skeptic's questions.
 *
 * Every answer here has to survive the question "which section already said
 * this?" — the gates, the sandboxes and the bridge all have panes of their
 * own in the proof band, and reprinting them is what once made half the
 * accordion read as terms of service. Three answers are load-bearing:
 *   - the naming question, the only place the pun is told straight rather than
 *     through the alphabet wall;
 *   - the tests question, the only place the anti-tamper contract is quoted;
 *   - "does the loop do anything on its own", the only place the page admits
 *     the loop may correctly find nothing to do.
 * 2026-10-20: the built-on/cost answer folded into the capabilities answer —
 * seven items, not eight.
 */
const FAQ = [
  {
    q: "Why is it called Unown?",
    a: "Two reasons. The mechanical one: an agent with tiered memory is a thing that reads what you write down. The lucky one: unown is a typo of “unknown”, and an agent whose memory might be wrong should be named for the possibility of not knowing.",
  },
  {
    q: "Are you affiliated with Nintendo or The Pokémon Company?",
    a: "No. An independent MIT-licensed developer tool that happens to be named after a Pokémon.",
  },
  {
    q: "Does it send my code anywhere?",
    a: "Only to the model endpoint you configure. Unown itself has no telemetry, no account and no analytics. The engine, the llm-bridge and the dashboard all run on your machine, and the upstream key lives only in your .env.",
  },
  {
    q: "Which models does it work with?",
    a: "Any OpenAI-compatible endpoint, hosted or local. Background learning can also run fully local and offline, on llama.cpp or Ollama through the bridge, while coding sessions stay on the remote model.",
  },
  {
    q: "What can it actually do?",
    a: "Beyond the five mechanisms above: multi-type hooks (command, HTTP, MCP-tool, prompt, agent) with semantic output and seven new event surfaces; an opt-in Adversary Mode (file-gated PreToolUse LLM reviewer) plus a 106-pattern prompt-injection scanner; per-subagent model + effort + mcpServers routing; declarative Recipes (markdown/YAML instruction bundles with parameters, sub-recipes, response_schema and templates); a Repo Wiki that auto-generates markdown docs with file:line cross-links; a Mem0-backed learning core — the engine behind AutoDreaming — with semantic recall over what it learned (GET /api/memories?q=…, offline-capable with a deterministic fallback embedder), repo-stable memory scopes (one repository, one memory across clones, worktrees and machines — same-named directories never share a bank), a preserved ## Manual notes hand-edit lane in project memory, and cross-project recall (/memory search <query> fans one semantic search over every project that has learned anything — read-only, scope-tagged); /init-agents and /doctor-instructions for instruction-set management; /blame and unown sessions export|import|list for session forensics; and proportional auto-compact on the token limit. Every one of these is reverse-engineered from the 2026 coding agents (codex, claude code, goose, zcode, opencode, cursor) — the receipts and the design decisions are in docs/sdlc-feature-parity.md Round 5. Built on the open-source pi coding agent by Mario Zechner, MIT licensed end to end, no licence fee and no service tier; the only cost is whatever your model endpoint charges you.",
  },
  {
    q: "Will it rewrite my tests to make them pass?",
    a: "The seeded policy tier in memory literally says not to: “If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.” In the terminal session that is an instruction; in the engine it is structural: benchmark tests are sha256-pinned and restored to pristine state before scoring, so an agent that edits them scores zero. Unown writes to .unown/memory/*.md and stages minted skills into .unown/skills-staged/*.md (never auto-loaded — promotion is a human mv) — not your source; and the agent cannot write its own rule files: in-session writes to AGENTS.md, .unown/skills/** and the hook/permission configs are hard-denied, changes go through a PR.",
  },
  {
    q: "Does the loop actually do anything on its own?",
    a: "Honest answer: only when the model actually struggles. With kimi-k2.5 through the bridge, the seeded benchmark tasks are solved unaided, so the mining and shipping machinery correctly finds nothing to ship: an engine that patched memory for no reason would be a bug. Point it at a weaker model, or let task minting author harder variants once the suite saturates, and the loop starts firing on its own.",
  },
];

export function FaqSection() {
  return (
    <section data-hue="gold" id="faq" className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
          <FadeUp>
            <SectionHead
              kicker="FAQ"
              lead="Including the one that decides installs: will it rewrite my tests to make them pass."
            >
              The skeptic&apos;s questions.
            </SectionHead>
          </FadeUp>

          <FadeUp delay={0.06}>
            <Accordion type="single" collapsible className="w-full">
              {FAQ.map((item) => (
                <AccordionItem
                  key={item.q}
                  value={item.q}
                 
                  className="gb-panel mb-3 border-0 last:mb-0"
                >
                  <AccordionTrigger className="group rounded-none text-left text-[14.5px] font-medium text-ink hover:no-underline hover:text-gold [&>svg]:hidden">
                    <span className="flex items-center gap-2.5">
                      <PixelCursor className="h-3 w-[7px] shrink-0 text-gold opacity-0 transition-opacity group-data-[state=open]:opacity-100" />
                      <span>{item.q}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="gb-term text-[19px] leading-snug text-dim">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
