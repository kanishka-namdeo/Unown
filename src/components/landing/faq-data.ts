/**
 * The FAQ's data, in its own module so two very different consumers read one
 * source (the facts-once rule):
 *
 *  - `faq.tsx` renders it into the accordion a reader sees;
 *  - `seo.tsx` serializes it into the page's FAQPage JSON-LD, so the
 *    structured data cannot drift from the visible answers by one word.
 *
 * `faq.tsx` is a client component (the accordion is), and a server component
 * cannot import values out of a client module — which is why the array lives
 * here and not there. Every answer still has to survive "which section
 * already said this?": the gates, the sandboxes and the bridge all have
 * panes of their own in the proof band, and reprinting them is what once
 * made half the accordion read as terms of service. Three answers are
 * load-bearing:
 *   - the naming question, the only place the pun is told straight rather
 *     than through the alphabet wall;
 *   - the tests question, the only place the anti-tamper contract is quoted;
 *   - "does the loop do anything on its own", the only place the page admits
 *     the loop may correctly find nothing to do.
 * Seven items is a decision, not an oversight (2026-10-20: the built-on/cost
 * answer folded into the capabilities answer).
 */
export const FAQ: readonly { q: string; a: string }[] = [
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
    a: "Beyond the five mechanisms above: multi-type hooks (command, HTTP, MCP-tool, prompt, agent) with semantic output and seven new event surfaces; an opt-in Adversary Mode (file-gated PreToolUse LLM reviewer) plus a 106-pattern prompt-injection scanner; per-subagent model + effort + mcpServers routing; declarative Recipes (markdown/YAML instruction bundles with parameters, sub-recipes, response_schema and templates); a Repo Wiki that auto-generates markdown docs with file:line cross-links; a Mem0-backed learning core behind AutoDreaming — semantic recall over what it learned (GET /api/memories?q=…, offline-capable with a deterministic fallback embedder), repo-stable scopes (one repository, one memory across clones, worktrees and machines), a preserved ## Manual notes hand-edit lane, and cross-project recall (/memory search <query> — read-only, scope-tagged); /init-agents and /doctor-instructions for instruction-set management; /blame and unown sessions export|import|list for session forensics; and proportional auto-compact on the token limit. All reverse-engineered from the 2026 coding agents (codex, claude code, goose, zcode, opencode, cursor) — receipts and decisions in docs/sdlc-feature-parity.md Round 5. Built on the open-source pi coding agent by Mario Zechner, MIT licensed end to end, no licence fee and no service tier; the only cost is whatever your model endpoint charges you.",
  },
  {
    q: "Will it rewrite my tests to make them pass?",
    a: "The seeded policy tier in memory literally says not to: “If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.” In the terminal session that is an instruction; in the engine it is structural: benchmark tests are sha256-pinned and restored to pristine state before scoring, so an agent that edits them scores zero. Unown writes to .unown/memory/*.md and stages minted skills into .unown/skills-staged/*.md (never auto-loaded — promotion is a human mv) — not your source; and the agent cannot write its own rule files: in-session writes to AGENTS.md, .unown/skills/**, the hook/permission configs — and the project memory file itself (the Manual-notes lane is hand-edit territory, preserved verbatim by dreams but framed as hand-edited) — are hard-denied, changes go through a PR.",
  },
  {
    q: "Does the loop actually do anything on its own?",
    a: "Honest answer: only when the model actually struggles. With kimi-k2.5 through the bridge, the seeded benchmark tasks are solved unaided, so the mining and shipping machinery correctly finds nothing to ship: an engine that patched memory for no reason would be a bug. Point it at a weaker model, or let task minting author harder variants once the suite saturates, and the loop starts firing on its own.",
  },
];
