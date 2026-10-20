/**
 * The lexicon — 28 forms, each decoded twice.
 *
 * `lore` is a short, attributed quotation or verified fact about the Pokémon
 * this project is named after. `means` is the part that actually matters: what
 * that glyph stands for in Unown. Every `means` line describes real behaviour
 * in this repo — if you change a mechanism, change the line.
 *
 * `means` is a DECODE, not a specification, and it is kept short on purpose: a
 * wall of twenty-eight entries is only readable if each one is a caption. Every
 * mechanism that owns a section of its own is named here and described there —
 * the gates live in `integrity.tsx` `GATES[]`, the sandbox in its two sandbox
 * paragraphs, the model allow-list in `models.tsx`, the measured numbers in
 * `benchmarks.tsx`. Restating one of those here is what turned this file into
 * 507 words of technical prose that read the page back at itself; it is now a
 * reference table a visitor can skim, which is the only instrument that suits
 * twenty-eight entries.
 *
 * Sourcing rule for this file: only lore that was verified against Bulbapedia,
 * PokémonDB, Wikipedia or ssbwiki. Popular but wrong (the "sleeping stick"
 * line, the Lavender Town story, Unown letters in Deltarune SAVE points) is
 * deliberately absent. See `docs/landing-research.md` for the full audit.
 */

import type { GlyphId } from "./glyphs";

export type LexiconEntry = {
  id: GlyphId;
  /** Verifiable Pokémon fact, quoted in the spirit of the source. */
  lore: string;
  /** Where it came from — shown on hover so quotes are never mistaken for our copy. */
  loreSrc?: string;
  /** What the glyph means in Unown. Always a real mechanism. Short by design. */
  means: string;
  /** Optional proof: a number or a path in the repo. */
  proof?: string;
};

export const LEXICON: LexiconEntry[] = [
  {
    id: "A",
    lore: "In Johto, a wild Unown's letter was computed from its hidden stats.",
    loreSrc: "Gen II internals",
    means: "Attribution. Every memory write is stamped with its author.",
    proof: "engine tiers + version history",
  },
  {
    id: "B",
    lore: "A 2001 contest asked children to spell words in the Unown alphabet, with tuition as the prize.",
    loreSrc: "Pokémon Crystal promo",
    means: "Bubblewrap. Read-only root, private /tmp, killed network namespace.",
    proof: "verify_sandbox.mjs — 12 checks",
  },
  {
    id: "C",
    lore: "A lenticular decoder card shipped with Pokémon 3 to read the hidden messages.",
    loreSrc: "Gen III special edition",
    means: "Cold against warm. The same ten tasks, fresh memory versus dreamed memory.",
    proof: "benchmarks/selfimprove",
  },
  {
    id: "D",
    lore: "It lives in its own dimension and rarely ventures outside.",
    loreSrc: "Bulbapedia",
    means: "Dreams. Consolidation runs on the engine's clock, not inside your session.",
    proof: "PI_DREAM_GATE",
  },
  {
    id: "E",
    lore: "“Because different types of UNOWN exist, it is said that they must have a variety of abilities.”",
    loreSrc: "Pokédex · Crystal",
    means: "Capability evals. A minted task has to be genuinely hard first.",
    proof: "mint.ts — mint gate",
  },
  {
    id: "F",
    lore: "“When alone, nothing happens.”",
    loreSrc: "Pokédex · Platinum",
    means: "Failure is the raw material. The harness mines the transcript that did not pass, never the one that did.",
    proof: "harness.ts",
  },
  {
    id: "G",
    lore: "In the film, a swarm distorts reality to suit whichever being is in charge.",
    loreSrc: "Spell of the Unown: Entei",
    means: "…which is the argument for guardrails. Every decision is logged, and you can read it.",
    proof: "hooks.ts · termhooks.ts",
  },
  {
    id: "H",
    lore: "“Research into this topic is ongoing but nothing is known.”",
    loreSrc: "Pokédex · Ruby/Sapphire",
    means: "Harness cycles. Run the suite, mine the failure, propose a patch, re-run it, ship or discard.",
    proof: "harness-cycle job",
  },
  {
    id: "I",
    lore: "“Its flat, thin body is always stuck on walls. Its shape appears to have some meaning.”",
    loreSrc: "Pokédex · Silver",
    means: "Injection. The resolved memory stack rides every prompt.",
    proof: "unown memory",
  },
  {
    id: "J",
    lore: "Engraved on the floor of the Ruins of Alph: OUR WORDS SHALL REMAIN HERE FOR THE AGES.",
    loreSrc: "Ruins of Alph inscription",
    means: "Journals. Every dream, run and hook decision stays readable.",
    proof: "/dashboard",
  },
  {
    id: "K",
    lore: "It floats; Ground-type moves pass straight through it.",
    loreSrc: "Ability · Levitate",
    means: "No secrets in the tree. The upstream key lives in .env.",
    proof: ".env.example",
  },
  {
    id: "L",
    lore: "Most forms carry one weak ability. IGN printed it as the worst Pokémon ever made.",
    loreSrc: "IGN · reception",
    means: "The local tier. .unown/memory/local.md is yours, gitignored and never shipped.",
    proof: "4th memory tier",
  },
  {
    id: "M",
    lore: "“They seem to communicate among each other telepathically. They are always found stuck on walls.”",
    loreSrc: "Pokédex · Pearl",
    means: "Memory. Policy → project → user → local, versioned and rollback-able.",
    proof: "memory.ts",
  },
  {
    id: "N",
    lore: "In Pokémon GO it shows up only at events, where it spells things like SWORD and SHIELD.",
    loreSrc: "Pokémon GO events",
    means: "Notes. Every session hands the engine one before it exits, and they queue offline.",
    proof: "note-sync job",
  },
  {
    id: "O",
    lore: "German localisation: Icognito. Unknown plus incognito, shipped in 1999.",
    loreSrc: "PokémonDB language table",
    means: "Open source, all the way down. MIT licensed, no account, no telemetry.",
    proof: "LICENSE",
  },
  {
    id: "P",
    lore: "Professor Laventon, field note: “the species' many forms resemble writing from other lands; no one will take me seriously.”",
    loreSrc: "Pokédex · Legends: Arceus",
    means: "Project memory. .unown/memory/project.md — plain versioned Markdown you commit and diff.",
    proof: "per-project memory",
  },
  {
    id: "Q",
    lore: "One room in the Solaceon Ruins is inscribed with nothing but “?!”. Another spells FRIENDSHIP as a pathcode.",
    loreSrc: "Solaceon Ruins",
    means: "Questions. The loop exists to answer one: why did that run fail? Answer it with a rule, verify the rule, keep it only if it holds.",
    proof: "failure mining",
  },
  {
    id: "R",
    lore: "In the film a swarm compiles a grieving child's wishes into a god and a warped world — and then it all has to be taken back apart.",
    loreSrc: "Spell of the Unown: Entei",
    means: "Retention. A shipped patch that later regresses gets un-shipped, automatically.",
    proof: "retention check",
  },
  {
    id: "S",
    lore: "In Smash Bros. one Unown summons a swarm of thirty that carries the victim off the top of the screen.",
    loreSrc: "ssbwiki · frame data",
    means: "Skills. Recurring procedures in your notes become real SKILL.md files.",
    proof: "skills.ts · skill mint gate",
  },
  {
    id: "T",
    lore: "A 2006 paper taught taxonomy and phylogeny to a classroom using nothing but Unown forms.",
    loreSrc: "Science Scope",
    means: "Tiering. The most specific tier wins, every time, deterministically.",
    proof: "memory resolver",
  },
  {
    id: "U",
    lore: "Its name is the word “unknown” with the spelling knocked about. Its Japanese name is simply アンノーン.",
    loreSrc: "PokémonDB · Bulbapedia",
    means: "Unknown. Point Unown at any endpoint you are allowed to use.",
    proof: "9 providers on the model band",
  },
  {
    id: "V",
    lore: "French localisation: Zarbi — verlan, the slang that reverses syllables. Its own name is encrypted.",
    loreSrc: "Bulbapedia",
    means: "Verification. Benchmark tests are sha256-pinned and restored before scoring.",
    proof: "anti-tamper scoring",
  },
  {
    id: "W",
    lore: "336 base stats, one essentially-random move, and the fandom learned the alphabet anyway.",
    loreSrc: "Base stats · reception",
    means: "Warm memory. Repeat tasks with dreamed memory carried into fresh workspaces.",
    proof: "benchmarks/selfimprove",
  },
  {
    id: "X",
    lore: "Its appendages move independently, like tentacles or fingers.",
    loreSrc: "Bulbapedia · Biology",
    means: "Hooks fire at six points: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStop.",
    proof: "6 hook layers",
  },
  {
    id: "Y",
    lore: "A 2013 font, a translator web app, a Minecraft mod, a classroom taxonomy paper. People keep trying to make it into tooling.",
    loreSrc: "DaFont · CurseForge · Science Scope",
    means: "It yields. When a gate says no the engine obeys, then tries again.",
    proof: "ship · canary · mint gates",
  },
  {
    id: "Z",
    lore: "As of Legends: Z-A there is no Pokédex entry for it at all.",
    loreSrc: "Availability",
    means: "Zero lock-in. Any OpenAI-compatible endpoint you are allowed to use.",
    proof: "unown setup --provider",
  },
  {
    id: "!",
    lore: "The letters shipped in 1999. Punctuation arrived in 2004 — the slowest charset rollout in history.",
    loreSrc: "Form history",
    means: "The ship gate. Nothing lands on one green run.",
    proof: "verify ×2",
  },
  {
    id: "?",
    lore: "The punctuation forms are the only ones with half-closed eyes. Nobody has explained why.",
    loreSrc: "Bulbapedia · Biology",
    means: "The question the loop exists to answer: why did that run fail? Turn it into a rule, verify the rule, keep it only if it survives.",
    proof: "mining → patch → verify",
  },
];

export const LEXICON_BY_ID = new Map(LEXICON.map((e) => [e.id, e]));

/** The pull-quotes retired 2026-10-20, when the static Unown trading card
 *  (the last DEX_QUOTES consumer) left the alphabet band for the capability
 *  dex round: the Z highlight above the wall already carries the page's one
 *  game-voice quotation, and the same 33 words twice was the exact thing
 *  the facts-once rule exists to prevent. The texts live on in the field
 *  notes this file cites if a future round ever needs one back. */