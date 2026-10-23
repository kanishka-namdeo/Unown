import type { CreatureId } from "./creature";
import { ENGINE_JOB_COUNTS } from "./engine-data";

/**
 * The capability dex — twenty-one catalogued capabilities as one numbered spine.
 *
 * Two kinds share one list, one cursor and one detail pane:
 *
 *  - `form` (№ 001-011) is a feature the page draws: one original creature
 *    sprite (`creature.tsx`, the pipeline in `scripts/creature_sprites.mjs`),
 *    a game-voice `entry`, a `weakness` and the real capability copy. The dex
 *    is the ONE canonical home for creature art and capability prose; the
 *    retired placements (the hero's party strip, the loop's bento) stay
 *    retired.
 *  - `behavior` (№ 012-021) is a feature the page films instead: a workflow
 *    or surface that is not one form's capability, so it carries no specimen
 *    and no flavor — one summary gloss, its practice lines and its receipt.
 *    Lore stays on the forms, which is what keeps the page's lore:tech rule
 *    answerable rather than aspirational.
 *
 * Every entry carries `captures`: the feature's own terminal capture. Media
 * here is the TUI-capture lane's audited set verbatim (`public/landing/tui/
 * README.md`; workflow contract in `docs/tui-capture-workflow.md`) — nothing
 * was filmed for this band and nothing is made up. An entry the harness has
 * not turned through holds a `{ kind: "pending" }` element and renders the
 * honest empty stage, so the catalog's gap is a visible state, not a footnote.
 *
 * Voice: `entry` is game-voice flavor — what the form IS, in the collector
 * register the wall art already speaks (generic creature-collector vocabulary
 * only; never a species name). `practice` is the real capability description,
 * and the router's job tally stays generated from `JOB_DEFS` through
 * `scripts/landing_claims.mjs`. `weakness` is the skeptic's pain the feature
 * answers, phrased as a dex weakness row.
 *
 * `DexSection` renders this list verbatim; `dex.test.tsx` pins the spine and
 * the derived tallies, `creature.test.tsx` pins that the forms are exactly the
 * ten sprites.
 */

/** The two sides of the house: what joins a session vs what runs in the engine. */
export type DexType = "session" | "engine";

/** One piece of footage. `pending` is a gap stated out loud, never a frame. */
export type Capture =
  | { kind: "video"; webm: string; mp4: string; poster: string; label?: string }
  | { kind: "still"; src: string; alt: string }
  | { kind: "pending" };

interface DexBase {
  /** Catalog number, "001"–"020" — the spine, printed beside every name. */
  no: string;
  /** The feature's own word, the way the party chips said it. */
  name: string;
  kind: "form" | "behavior";
  /** The real capability copy — the only prose both kinds carry. */
  practice: string[];
  /** Receipt links: [label, GitHub href] straight at the source that ships it. */
  receipts: readonly (readonly [string, string])[];
  /** 0..N reels. A pending entry has exactly one `{ kind: "pending" }`. */
  captures: readonly Capture[];
}

export type FormEntry = DexBase & {
  kind: "form";
  id: CreatureId;
  /** Game-voice category, "the … form" — the collector register, original words. */
  category: string;
  type: DexType;
  /** Game-voice flavor. Original sentences only — never a quoted game text. */
  entry: string;
  /** The skeptic's pain this feature answers, as a weakness row. */
  weakness: string;
  /** Where it runs — one line. */
  habitat: string;
};

export type BehaviorEntry = DexBase & {
  kind: "behavior";
  /** A stable slug, never a `CreatureId` — behaviors have no specimen. */
  id: string;
  /** One-line gloss under the name. */
  summary: string;
};

export type DexEntry = FormEntry | BehaviorEntry;

const SRC = (file: string) =>
  `https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/src/${file}`;

const DOC = (path: string) =>
  `https://github.com/kanishka-namdeo/Unown/blob/main/${path}`;

/** A lane's movie plus the still that opens it, by the harness's own layout.
 * `label` is what the reel chip prints when an entry carries more than one. */
const REEL = (lane: string, poster: string, label?: string): Capture => ({
  kind: "video",
  webm: `/landing/tui/${lane}/${lane}.webm`,
  mp4: `/landing/tui/${lane}/${lane}.mp4`,
  poster: `/landing/tui/${lane}/stills/${poster}`,
  ...(label ? { label } : {}),
});

const STILL = (src: string, alt: string): Capture => ({ kind: "still", src, alt });

/** Every entry the harness has not filmed renders this instead of a frame. */
const PENDING: readonly Capture[] = [{ kind: "pending" }];

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
  /* ---------------------------------------------------------------- */
  /* № 001-011 — the forms: drawn, catalogued, filmed where filmed      */
  /* ---------------------------------------------------------------- */
  {
    kind: "form",
    id: "websearch",
    no: "001",
    name: "Websearch",
    category: "the crawler form",
    type: "session",
    entry:
      "A many-legged aqua crawler that laps the whole web before breakfast. It is out the window before the question finishes, and it does not come home without sources.",
    weakness: "a confident answer with no source",
    practice: [
      "Native web access through web_search and webfetch — keyless providers work out of the box, 19 total, an auto-selecting chain that keeps trying until one answers.",
      "A persistent web results store answers repeats from disk while fresh, revalidates by ETag (a 304 means the page never changed), serves stale answers instantly — marked — while a background refresh restores them, and keeps the last good answer — flagged stale — when every provider fails.",
      "Benchmarked with committed receipts: the dashboard's 8-second store poll dropped from a 49.9 ms disk scan to 0.003 ms answered from memory, and repeat hits answer ~200× faster through a bounded hot-entry memo.",
    ],
    habitat: "joins every session",
    receipts: [
      ["websearch.ts", SRC("websearch.ts")],
      ["webcache.ts", SRC("webcache.ts")],
      ["bench receipts", DOC("benchmarks/webcache/RESULTS.md")],
    ],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "mcp",
    no: "002",
    name: "Mcp",
    category: "the many-socketed form",
    type: "session",
    entry:
      "A tidy golem with three gold sockets on its chest. Plug a tool in anywhere — its arms already know the shape.",
    weakness: "a tool your stack has that your agent can't reach",
    practice: [
      "Any MCP server configured in .unown/mcp.json joins every session — its tools arrive as mcp__server__tool, permissions and all. Both the in-session and the CLI surface are in the usage docs.",
    ],
    habitat: "joins every session",
    receipts: [
      ["mcp.ts", SRC("mcp.ts")],
      ["docs/usage.md", DOC("docs/usage.md")],
    ],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "task",
    no: "003",
    name: "Task",
    category: "the splitting form",
    type: "session",
    entry:
      "One coil, many errands: it balances the glowing job on its tail until a fresh mind comes to take it — and it can split one loose in the background, steer it mid-run, take its questions and wake it again by name. What walks back is typed, and it cleaned up its worktree on the way.",
    weakness: "one context juggling ten jobs",
    practice: [
      "Subagents with a fresh context — typed replies via output_schema, per-child git worktree isolation, a completion guard that fails the silent no-op, and a BLOCKED lane for honest refusals.",
      "The async fleet: background spawns whose results steer back as new turns, mid-run steering and ask_question through task_control, resume-by-name from a persisted registry, and a live fleet widget — no terminal multiplexer, native on every OS.",
    ],
    habitat: "joins every session",
    receipts: [
      ["tools.ts", SRC("tools.ts")],
      ["fleet.ts", SRC("fleet.ts")],
      ["fleet-runtime.ts", SRC("fleet-runtime.ts")],
      ["docs/subagents.md", DOC("docs/subagents.md")],
    ],
    captures: [
      REEL("subagent-explore", "01-boot-in-real-repo.png", "subagent"),
      REEL("fleet", "01-boot-fleet-ready.png", "fleet"),
    ],
  },
  {
    kind: "form",
    id: "lsp",
    no: "004",
    name: "Lsp",
    category: "the reading form",
    type: "session",
    entry:
      "A patient bookwyrm that keeps its spectacles on. It takes the project line by line and taps your shoulder mid-edit, not after the commit.",
    weakness: "edit first, diagnose later",
    practice: [
      "Language-server intelligence — diagnostics ride every edit.",
      "A graph-ranked repo map (/repomap) orients fresh subagents before their first tool call.",
    ],
    habitat: "joins every session",
    receipts: [["lsp.ts", SRC("lsp.ts")]],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "memory",
    no: "005",
    name: "Memory",
    category: "the keeper form",
    type: "engine",
    entry:
      "A keeper that carries its whole archive on its back. Ask who told it what, and it opens the right drawer on the first try.",
    weakness: "re-explaining the project every session",
    practice: [
      "Four tiers — policy, project, user, local. Most-specific-wins, injected into every prompt; every write versioned and attributed.",
    ],
    habitat: "rides every prompt, session and subagent",
    receipts: [["memory.ts", SRC("memory.ts")]],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "harness",
    no: "006",
    name: "Harness",
    category: "the proving form",
    type: "engine",
    entry:
      "A coach with a stopwatch in its pouch. It does not trust a trick it has seen once — everything must pass twice, in a room it has never been in.",
    weakness: "it fixed the bug by editing the test",
    practice: [
      "A failing benchmark task runs in a fresh sandbox; the transcript is mined for the rule that would have prevented it, and the candidate re-runs against the patched memory.",
    ],
    habitat: "runs in the engine, on the clock",
    receipts: [["harness.ts", SRC("harness.ts")]],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "router",
    no: "007",
    name: "Router",
    category: "the wayfinding form",
    type: "engine",
    entry:
      "A signpost that walks its own routes. Two arrows, one for each direction of the loop, and never two of anything in the sandbox at once.",
    weakness: "improvement only happens when you remember to run it",
    practice: [
      JOB_SENTENCE,
      "A busy-mutex means the sandbox is never double-driven.",
    ],
    habitat: "runs in the engine, on the clock",
    receipts: [["router.ts", SRC("router.ts")]],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "dream",
    no: "008",
    name: "Dream",
    category: "the sleeping form",
    type: "engine",
    entry:
      "It counts itself to sleep and works the night shift. The diary it keeps is one the day shift can read, and nothing is retired without a dashboard's say-so.",
    weakness: "you find out it learned the wrong thing weeks later",
    practice: [
      "Notes consolidate into project memory; recurring procedures get minted as real Agent Skills. The engine never deletes your files — retirement is a dashboard action.",
    ],
    habitat: "runs in the engine, overnight",
    receipts: [["dream.ts", SRC("dream.ts")]],
    captures: PENDING,
  },
  {
    kind: "form",
    id: "hooks",
    no: "009",
    name: "Hooks",
    category: "the watchful form",
    type: "engine",
    entry: "Eyes up on stalks, shield planted in front, and not one of them blinks.",
    weakness: "it ran something it had no business running",
    practice: [
      "Guardrails at six layers — before the prompt, around every tool call, at session and subagent end — every allow, deny and augment logged.",
    ],
    habitat: "rides every session and subagent",
    receipts: [
      ["hooks.ts", SRC("hooks.ts")],
      ["docs/usage.md", DOC("docs/usage.md")],
    ],
    // The overlays clip opens /hooks over a running session, which is this
    // form's own surface; it also shows /model and /permissions, whose
    // canonical homes stay in the proof band and the hero.
    captures: [REEL("overlays", "01-model-picker.png")],
  },
  {
    kind: "form",
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
      ["docs/sdlc-feature-parity.md", DOC("docs/sdlc-feature-parity.md")],
    ],
    // Parity is a checklist, not a behavior, so nothing is filmed under this
    // number. The wiki and the diagnostics clips are catalogued as their own
    // entries (№ 015, № 016) rather than filed here as a catch-all.
    captures: PENDING,
  },

  {
    kind: "form",
    id: "browser",
    no: "011",
    name: "Browser",
    category: "the window form",
    type: "session",
    entry:
      "A living window that carries its own little page wherever it goes. It points at things with a golden claw, and the things obey.",
    weakness: "an agent that can read about the web but never touch it",
    practice: [
      "Drives a real Chromium over CDP — navigate, a11y-tree snapshots with element refs, trusted clicks and typing (isTrusted passes), forms in one call, tabs, downloads, cookies, console and network.",
      "Screenshots come back as image blocks the model sees directly — the vision loop grounds coordinate clicks against the picture. Auto-starts headless, keeps logins in a persistent profile, or attaches to the Chrome you are already logged into.",
      "Zero new runtime dependencies: the protocol is spoken directly over the runtime's native WebSocket, so the compiled binaries stay a closed graph.",
    ],
    habitat: "joins every session",
    receipts: [
      ["browser session", SRC("browser/session.ts")],
      ["browser tools", SRC("browser/tools.ts")],
      ["docs/browser.md", DOC("docs/browser.md")],
    ],
    captures: PENDING,
  },

  /* ---------------------------------------------------------------- */
  /* № 012-021 — the behaviors: filmed, not drawn                       */
  /* ---------------------------------------------------------------- */
  {
    kind: "behavior",
    id: "fix-loop",
    no: "012",
    name: "The fix loop",
    summary: "the working loop, start to finish",
    practice: [
      "A failing suite in a real repo: the agent investigates, edits, re-runs the tests until they pass. Six audited stills compress to one turn of the working loop.",
    ],
    receipts: [["tui-beauty RESULTS.md", DOC("benchmarks/tui-beauty/RESULTS.md")]],
    captures: [REEL("hero-bugfix", "01-boot-fresh-session.png")],
  },
  {
    kind: "behavior",
    id: "plan-mode",
    no: "013",
    name: "Plan mode",
    summary: "read-only until you approve",
    practice: [
      "Read-only until approved: /plan drafts the numbered plan, the approval overlay hands execution over, and the plan runs to completion.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    captures: [REEL("plan-mode", "01-session.png")],
  },
  {
    kind: "behavior",
    id: "checkpoints",
    no: "014",
    name: "Checkpoints",
    summary: "write, list, undo, redo — one session",
    practice: [
      "One session, four beats: a rename writes the checkpoint, /checkpoints lists them, /undo reverts the tree, /redo restores it.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    captures: [REEL("checkpoints", "01-rename-done.png")],
  },
  {
    kind: "behavior",
    id: "review",
    no: "015",
    name: "Review",
    summary: "adversarial reviewers before the ship",
    practice: [
      "A /review over an uncommitted fix: the reviewers run, the SHIP verdict lands, the review artifact is written to disk.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    captures: [REEL("review", "01-session-with-uncommitted-diff.png")],
  },
  {
    kind: "behavior",
    id: "wiki",
    no: "016",
    name: "The wiki",
    summary: "generate this repository's wiki, then search it",
    practice: [
      "/wiki generates this repository's wiki, then the same panel searches it with scored results.",
    ],
    receipts: [
      ["repo-wiki.ts", SRC("repo-wiki.ts")],
      ["docs/usage.md", DOC("docs/usage.md")],
    ],
    captures: [REEL("wiki", "01-wiki-generating.png")],
  },
  {
    kind: "behavior",
    id: "doctor",
    no: "017",
    name: "Doctor",
    summary: "the CLI outside a session",
    practice: [
      "A shell showcase in three commands: unown doctor walks the chat path, models lists the routing, usage reports the spend.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    captures: [REEL("cli-doctor", "01-doctor.png")],
  },
  {
    kind: "behavior",
    id: "split-view",
    no: "018",
    name: "Split view",
    summary: "the display mode's own band, dock and transcript",
    practice: [
      "A Thinking panel and a Tool Usage band across the top, a Files dock with its edit-diff subpanel on the right, a response-only transcript. A built-in port of pi-split-view 1.1.0, shipped with every session. Stills only — this lane ships no movie.",
    ],
    receipts: [["docs/split-view.md", DOC("docs/split-view.md")]],
    captures: [
      STILL(
        "/landing/tui/split-view/stills/01-band-thinking-tools.png",
        "unown split view — the top band with a Thinking panel beside a Tool Usage panel, the transcript below",
      ),
    ],
  },
  {
    kind: "behavior",
    id: "goals",
    no: "019",
    name: "Goals",
    summary: "objectives closed against cited evidence",
    practice: [
      "A durable objective the session completes against cited evidence — the usage docs' goals section carries the rules.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    captures: PENDING,
  },
  {
    kind: "behavior",
    id: "routines",
    no: "020",
    name: "Routines",
    summary: "recurring runs on real recurrence semantics",
    practice: [
      "Recurring runs on real recurrence semantics — docs/routines.md is the decision record.",
    ],
    receipts: [["docs/routines.md", DOC("docs/routines.md")]],
    captures: PENDING,
  },
  {
    kind: "behavior",
    id: "skills",
    no: "021",
    name: "Skills",
    summary: "instruction files loaded on demand",
    practice: [
      "Instruction files the session loads on demand — docs/skills.md has the surface.",
    ],
    receipts: [["docs/skills.md", DOC("docs/skills.md")]],
    captures: PENDING,
  },
];

/* ------------------------------------------------------------------ */
/* derived tallies — every figure on the band is read off this list    */
/* ------------------------------------------------------------------ */

/** An entry is filmed when at least one of its captures is a real capture. */
export const isFilmed = (e: DexEntry) => e.captures.some((c) => c.kind !== "pending");

const countCaptures = (kind: Capture["kind"]) =>
  DEX.reduce((n, e) => n + e.captures.filter((c) => c.kind === kind).length, 0);

/** The media mix, derived. Nothing on the band types any of these numbers. */
export const TALLY = {
  total: DEX.length,
  forms: DEX.filter((e) => e.kind === "form").length,
  behaviors: DEX.filter((e) => e.kind === "behavior").length,
  videos: countCaptures("video"),
  stills: countCaptures("still"),
  filmed: DEX.filter(isFilmed).length,
  pending: DEX.filter((e) => !isFilmed(e)).length,
} as const;

/** The pane the band opens on: the first entry that actually has footage, so
 * a reader who does nothing sees a capture instead of an empty stage. Derived
 * for the same reason the tallies are — a typed index would rot. */
export const DEFAULT_INDEX = DEX.findIndex(isFilmed);

/** Forms indexed by creature id — the detail pane's specimen lookup. */
export const FORMS_BY_ID: ReadonlyMap<CreatureId, FormEntry> = new Map(
  DEX.flatMap((e) => (e.kind === "form" ? [[e.id, e] as const] : [])),
);

/** The spelled-out tally sentence the band's lead prints. */
export const TALLY_SENTENCE =
  `${TALLY.filmed} of ${TALLY.total} carry a capture — ${TALLY.videos} movies, ` +
  `${TALLY.stills} still set, ${TALLY.pending} pending. Nothing here was filmed by hand.`;
