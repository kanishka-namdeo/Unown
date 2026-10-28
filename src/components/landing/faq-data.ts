/**
 * The FAQ's data, in its own module so two very different consumers read one
 * source (the facts-once rule): `faq.tsx` renders the accordion; `seo.tsx`
 * serializes the same strings into the page's FAQPage JSON-LD — the
 * structured data cannot drift from the visible answers by one word. The
 * array lives here because a server component cannot import values out of
 * a client module.
 *
 * Every answer still has to survive "which section already said this?" —
 * the proof band owns the receipts. Three answers are load-bearing: the
 * naming question (the pun, told straight), the tests question (the
 * anti-tamper contract, quoted) and "does the loop do anything on its own"
 * (the honest null). Seven items is a decision (2026-10-20: the built-on/cost
 * answer folded into the capabilities answer).
 */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "Why is it called Unown?",
    a: "Two reasons. The mechanical one: an agent with tiered memory reads what you write down. The lucky one: unown is a typo of “unknown”, and an agent whose memory might be wrong should be named for the possibility of not knowing.",
  },
  {
    q: "Are you affiliated with Nintendo or The Pokémon Company?",
    a: "No. An independent MIT-licensed developer tool that happens to be named after a Pokémon.",
  },
  {
    q: "Does it send my code anywhere?",
    a: "Only to the model endpoint you configure. Unown itself has no telemetry, no account and no analytics. The engine, bridge and dashboard all run on your machine; the upstream key lives only in your .env.",
  },
  {
    q: "Which models does it work with?",
    a: "Any OpenAI-compatible endpoint, hosted or local. Background learning can also run fully local and offline, on llama.cpp or Ollama through the bridge, while coding sessions stay on the remote model.",
  },
  {
    q: "What can it actually do?",
    a: "Beyond the five mechanisms above: multi-type hooks (command, HTTP, MCP-tool, prompt, agent) with semantic output; an opt-in Adversary Mode plus a 106-pattern prompt-injection scanner; per-subagent model + effort + mcpServers routing; declarative Recipes (markdown/YAML bundles with parameters and templates); a Repo Wiki that auto-generates docs with file:line cross-links; a Mem0-backed learning core behind AutoDreaming — semantic recall, repo-stable scopes, a preserved ## Manual hand-edit lane, cross-project recall; /init-agents and /doctor-instructions; /blame and unown sessions export|import|list; proportional auto-compact on the token limit. Reverse-engineered from the 2026 coding agents — receipts and decisions in docs/sdlc-feature-parity.md Round 5. Built on the open-source pi coding agent by Mario Zechner, MIT licensed end to end, no licence fee and no service tier; the only cost is whatever your model endpoint charges you.",
  },
  {
    q: "Will it rewrite my tests to make them pass?",
    a: "The seeded policy tier literally says not to: “If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.” In the terminal that is an instruction; in the engine it is structural: benchmark tests are sha256-pinned and restored before scoring, so an agent that edits them scores zero. Unown writes to .unown/memory/*.md and stages minted skills into .unown/skills-staged/*.md (never auto-loaded — promotion is a human mv), not your source; and in-session writes to its own rule files — AGENTS.md, .unown/skills/**, the hook/permission configs, the project memory file (the Manual-notes lane stays hand-edit) — are hard-denied; changes go through a PR.",
  },
  {
    q: "Does the loop actually do anything on its own?",
    a: "Honest answer: only when the model actually struggles. With kimi-k2.5 through the bridge the seeded tasks are solved unaided, so the mining and shipping machinery correctly finds nothing to ship — an engine that patched memory for no reason would be a bug. Point it at a weaker model, or let task minting author harder variants once the suite saturates, and the loop fires on its own.",
  },
];
