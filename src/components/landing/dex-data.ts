import type { CreatureId } from "./creature";
import { ENGINE_JOB_COUNTS } from "./engine-data";

/**
 * The capability dex — the ten feature creatures as a catalog.
 *
 * One entry per original creature sprite (`creature.tsx`, the pipeline in
 * `scripts/creature_sprites.mjs`). The dex is the page's ONE canonical home
 * for creature art AND for the capability copy: the practice lines moved
 * here from the loop bento and the hero's cli expander when the band was
 * added (2026-10-20), so nothing below is a restatement — the
 * facts-stated-exactly-once rule (landing AGENTS.md) travels with the copy.
 *
 * Voice: `entry` is game-voice flavor — what the form IS, in the collector
 * register the wall art already speaks (generic creature-collector
 * vocabulary only; never a species name, the IP contract of Part 14).
 * `practice` is the real capability description, gated the same way it
 * always was — numbers stay checkable, receipts stay linked. `weakness` is
 * the skeptic's pain the feature answers, phrased as a dex weakness row.
 *
 * № order: the four session tools (the old hero party), then the six
 * engine-side mechanisms (the old bento). `DexSection` renders this list
 * verbatim; `dex.test.tsx` pins it.
 */

/** The two sides of the house: what joins a session vs what runs in the engine. */
export type DexType = "session" | "engine";

export type DexEntry = {
  id: CreatureId;
  /** Dex number, "001"–"010" — the catalog's spine, printed beside every name. */
  no: string;
  /** The creature's name — the feature's own word, the way the party chips said it. */
  name: string;
  /** Game-voice category, "the … form" — the collector register, original words. */
  category: string;
  type: DexType;
  /** Game-voice flavor. Original sentences only — never a quoted game text. */
  entry: string;
  /** The skeptic's pain this feature answers, as a weakness row. */
  weakness: string;
  /** The real capability copy — moved here from the bento / the cli expander. */
  practice: string[];
  /** Where it runs — one line. */
  habitat: string;
  /** Receipt links: [label, GitHub href] straight at the source that ships it. */
  receipts: readonly (readonly [string, string])[];
};

const SRC = (file: string) =>
  `https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/src/${file}`;

const NUM_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];
const word = (n: number) => NUM_WORDS[n] ?? String(n);

/** The engine's job tally, derived from `JOB_DEFS` in `router.ts` via
 * `scripts/landing_claims.mjs` — the router entry cannot drift from the
 * scheduler the way a hand-typed count would. Same sentence the loop
 * bento's routing tile carried; it moved here with the tile (counts
 * spelled out because the line reads as prose). */
const JOB_SENTENCE =
  `${word(ENGINE_JOB_COUNTS.total).replace(/^./, (c) => c.toUpperCase())} jobs keep the loop moving in the background ` +
  `without you: ${word(ENGINE_JOB_COUNTS.interval)} on a timer, ` +
  `${word(ENGINE_JOB_COUNTS.event)} on events.`;

/** The M1-M4 receipt row for the Parity entry — one link per ported
 * capability, straight at the file that implements it (the set the parity
 * doc Round 5 table describes; `landing-copy.test.tsx` pins it). */
const PARITY_RECEIPTS = [
  ["hooks-config.ts", SRC("hooks-config.ts")],
  ["adversary.ts", SRC("adversary.ts")],
  ["subagent-routing.ts", SRC("subagent-routing.ts")],
  ["recipes.ts", SRC("recipes.ts")],
  ["repo-wiki.ts", SRC("repo-wiki.ts")],
  ["init-agents.ts", SRC("init-agents.ts")],
  ["blame.ts", SRC("blame.ts")],
  ["auto-compact.ts", SRC("auto-compact.ts")],
] as const;

export const DEX: readonly DexEntry[] = [
  {
    id: "websearch",
    no: "001",
    name: "Websearch",
    category: "the signal form",
    type: "session",
    entry:
      "A round aqua bird with dish ears. It is out the window before the question finishes, and it does not come home without sources.",
    weakness: "a confident answer with no source",
    practice: [
      "Native web access through web_search and webfetch — keyless providers work out of the box, 19 total, an auto-selecting chain that keeps trying until one answers.",
    ],
    habitat: "joins every session",
    receipts: [["websearch.ts", SRC("websearch.ts")]],
  },
  {
    id: "mcp",
    no: "002",
    name: "Mcp",
    category: "the many-handed form",
    type: "session",
    entry:
      "Four arms, three tools, one shrug. Hand it a server config and the arms multiply.",
    weakness: "a tool your stack has that your agent can't reach",
    practice: [
      "Any MCP server configured in .unown/mcp.json joins every session — its tools arrive as mcp__server__tool, permissions and all.",
    ],
    habitat: "joins every session",
    receipts: [["mcp.ts", SRC("mcp.ts")]],
  },
  {
    id: "task",
    no: "003",
    name: "Task",
    category: "the splitting form",
    type: "session",
    entry:
      "It splits off a fresh mind and hands it the job. What walks back is typed, and it cleaned up its worktree on the way.",
    weakness: "one context juggling ten jobs",
    practice: [
      "Subagents with a fresh context — typed replies via output_schema and per-child git worktree isolation via worktree_isolation.",
    ],
    habitat: "joins every session",
    receipts: [["tools.ts", SRC("tools.ts")]],
  },
  {
    id: "lsp",
    no: "004",
    name: "Lsp",
    category: "the reading form",
    type: "session",
    entry:
      "A patient reader that knows the project's grammar by heart. It taps your shoulder mid-edit, not after the commit.",
    weakness: "edit first, diagnose later",
    practice: ["Language-server intelligence — diagnostics ride every edit."],
    habitat: "joins every session",
    receipts: [["lsp.ts", SRC("lsp.ts")]],
  },
  {
    id: "memory",
    no: "005",
    name: "Memory",
    category: "the keeper form",
    type: "engine",
    entry:
      "It never forgets where it put things — and can always tell you who told it, and when.",
    weakness: "re-explaining the project every session",
    practice: [
      "Four tiers — policy, project, user, local. Most-specific-wins, injected into every prompt; every write versioned and attributed.",
    ],
    habitat: "rides every prompt, session and subagent",
    receipts: [["memory.ts", SRC("memory.ts")]],
  },
  {
    id: "harness",
    no: "006",
    name: "Harness",
    category: "the proving form",
    type: "engine",
    entry:
      "It does not trust a trick it has seen once. Everything must pass twice, in a room it has never been in.",
    weakness: "it fixed the bug by editing the test",
    practice: [
      "A failing benchmark task runs in a fresh sandbox; the transcript is mined for the rule that would have prevented it, and the candidate re-runs against the patched memory.",
    ],
    habitat: "runs in the engine, on the clock",
    receipts: [["harness.ts", SRC("harness.ts")]],
  },
  {
    id: "router",
    no: "007",
    name: "Router",
    category: "the clockwork form",
    type: "engine",
    entry:
      "Small, tireless, always counting. It never lets two of anything into the sandbox at once.",
    weakness: "improvement only happens when you remember to run it",
    practice: [
      JOB_SENTENCE,
      "A busy-mutex means the sandbox is never double-driven.",
    ],
    habitat: "runs in the engine, on the clock",
    receipts: [["router.ts", SRC("router.ts")]],
  },
  {
    id: "dream",
    no: "008",
    name: "Dream",
    category: "the sleeping form",
    type: "engine",
    entry:
      "It works the night shift and keeps a diary the day can read. Nothing is retired without a dashboard's say-so.",
    weakness: "you find out it learned the wrong thing weeks later",
    practice: [
      "Notes consolidate into project memory; recurring procedures get minted as real Agent Skills. The engine never deletes your files — retirement is a dashboard action.",
    ],
    habitat: "runs in the engine, overnight",
    receipts: [["dream.ts", SRC("dream.ts")]],
  },
  {
    id: "hooks",
    no: "009",
    name: "Hooks",
    category: "the watchful form",
    type: "engine",
    entry: "Six eyes, and not one of them blinks.",
    weakness: "it ran something it had no business running",
    practice: [
      "Guardrails at six layers — before the prompt, around every tool call, at session and subagent end — every allow, deny and augment logged.",
    ],
    habitat: "rides every session and subagent",
    receipts: [["hooks.ts", SRC("hooks.ts")]],
  },
  {
    id: "sdlc",
    no: "010",
    name: "Parity",
    category: "the checklist form",
    type: "engine",
    entry: "Born counting: fifteen ports in four milestones, and it counts out loud.",
    weakness: "the 2026 coding agents set the bar",
    practice: [
      "Multi-type hooks, Adversary Mode + injection scanner, Per-subagent routing, Recipes, Repo Wiki, /init + /doctor, /blame + /sessions, Auto-compact — 15 ports across four milestones.",
    ],
    habitat: "shipped across Milestones 1-4",
    receipts: [
      ...PARITY_RECEIPTS,
      [
        "docs/sdlc-feature-parity.md",
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/sdlc-feature-parity.md",
      ],
    ],
  },
];

/** `DEX` indexed by creature id — the detail pane's lookup. */
export const DEX_BY_ID: ReadonlyMap<CreatureId, DexEntry> = new Map(
  DEX.map((e) => [e.id, e]),
);
