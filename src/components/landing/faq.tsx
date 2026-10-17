"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FadeUp, PixelCursor, SectionHead } from "./shell";

const FAQ = [
  {
    q: "Why is it called Unown?",
    a: "Two reasons. The mechanical one: an agent with tiered memory is a thing that reads what you write down, which is the single most characteristic thing about Unown. The lucky one: unown is a typo of “unknown”, and an agent whose memory might be wrong should be named for the possibility of not knowing. Unown is the Symbol Pokémon — a flat black letter with one eye, alive since 1999, found on the walls of ruins reading the writing there.",
  },
  {
    q: "Are you affiliated with Nintendo or The Pokémon Company?",
    a: "No. This is an independent, MIT-licensed developer tool that happens to be named after a Pokémon. No sprite, card, logo, artwork or audio from any Pokémon release is bundled, hotlinked or reproduced. Short quotations of game text appear on the landing page with the source named, for commentary.",
  },
  {
    q: "Does it send my code anywhere?",
    a: "Only to the model endpoint you configure. Unown itself has no telemetry, no account and no analytics. The engine, the llm-bridge and the dashboard all run on your machine, and the upstream key lives only in your .env.",
  },
  {
    q: "Which models does it work with?",
    a: "Any OpenAI-compatible endpoint: Dashscope, OpenAI, Anthropic, OpenRouter, DeepSeek, or a local vLLM / Ollama / llama.cpp server. The bundled bridge maps requested model ids onto an allow-list, injects auth, translates thinking flags for qwen models, passes tool calls and images through natively, and streams SSE back untouched. Or skip the bridge and point the terminal agent straight at a provider with unown setup.",
  },
  {
    q: "Will it rewrite my tests to make them pass?",
    a: "The seeded policy tier in memory literally says not to: “If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.” In the terminal session that is an instruction; in the engine it is structural — benchmark tests are sha256-pinned and restored to pristine state before scoring, so an agent that edits them scores zero. Unown writes to .unown/memory/*.md and .unown/skills/*.md. It does not touch your source, and it does not touch your AGENTS.md.",
  },
  {
    q: "What happens if a dream makes things worse?",
    a: "Every consolidation runs a canary first: the most recently passing task has to re-pass under the new memory. If it does not, the dream is rolled back automatically and logged as gated. Shipped patches that regress later get un-shipped by the retention check, and every memory version stays rollback-able from the dashboard.",
  },
  {
    q: "Is it safe to run on my repo?",
    a: "Two different policies for two different places. Engine runs are hard-walled: bubblewrap with a read-only root, private /home, /tmp and /run, a killed network namespace and dropped capabilities — so sudo and outbound calls are refused outright, and your repo and .env are invisible from inside. Terminal sessions are scoped for real work instead: filesystem-root deletion, fork bombs, disk formats and writes outside the project are blocked, while network, git push and package installs stay available. UNOWN_STRICT_HOOKS=1 restores sandbox-grade strictness.",
  },
  {
    q: "Does the loop actually do anything on its own?",
    a: "Honest answer: only when the model actually struggles. With kimi-k2.5 through the bridge, the five seeded benchmark tasks are solved unaided, so the mining and shipping machinery correctly finds nothing to ship — an engine that patched memory for no reason would be a bug. Point it at a weaker model, or let task minting author harder variants once the suite saturates, and the loop starts firing on its own.",
  },
  {
    q: "What is it built on, and what does it cost?",
    a: "The open-source pi coding agent by Mario Zechner, wrapped in a self-learning layer that lives in this repository rather than in a fork. MIT licensed end to end. No licence fee, no service tier — the only cost is whatever your model endpoint charges you.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-16 border-t border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
          <FadeUp>
            <SectionHead
              tone="purple"
              kicker="FAQ"
              lead="Including the two that decide whether anyone installs a self-modifying agent: is it safe, and will it touch my tests."
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
                  data-tone="purple"
                  className="gb-panel mb-3 border-0 last:mb-0"
                >
                  <AccordionTrigger className="group rounded-none text-left text-[14.5px] font-medium text-ink hover:no-underline hover:text-glow [&>svg]:hidden">
                    <span className="flex items-center gap-2.5">
                      <PixelCursor className="h-3 w-[7px] shrink-0 text-glow opacity-0 transition-opacity group-data-[state=open]:opacity-100" />
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