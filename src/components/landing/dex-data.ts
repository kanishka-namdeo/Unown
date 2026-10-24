import type { CreatureId } from "./creature";
import { ENGINE_JOB_COUNTS } from "./engine-data";

/**
 * The capability dex — a growing catalog on one numbered spine, browsed a
 * screen at a time.
 *
 * Scalability is the file's first contract (2026-10-24 round,
 * docs/landing-research.md "the category screens"): the project keeps adding
 * capabilities, so the design that held at twenty-two entries has to hold at
 * a hundred without the band growing a hundred-row list. Three rules do it:
 *
 *  - **the number is derived, never typed.** No entry carries a hand-written
 *    `no` — it is stamped from array position at module load. Appending the
 *    twenty-second capability is a one-object edit; the number it gets is
 *    the next one, not a decision. Reordering the array is the one edit that
 *    renumbers, so the spine's order is contract, not accident.
 *  - **the screen is a category, and categories live in data.** The selector
 *    row, the per-screen counts, the pool the search intersects and the
 *    screen a deep link lands on all reduce over `CATEGORY_DEFS` — adding a
 *    category is a one-object edit there, and adding an entry to a category
 *    is the `screen`/`type` field it already carries.
 *  - **two kinds still share one list** — `form` entries (a drawn creature,
 *    game-voice `entry`, `weakness`, real capability copy) and `behavior`
 *    entries (a filmed or filmed-someday surface that belongs to no single
 *    form: one `summary` gloss, practice lines, receipts). Lore stays on the
 *    forms, which is what keeps the page's lore:tech rule answerable.
 *
 * Adding a capability, the whole workflow: append one object to `RAW` with
 * its `kind`, stable `id`, copy, `receipts` and `captures` — everything the
 * page prints (its number, its screen, every tally, the default pane) is
 * derived. A capture is `REEL(…)`/`STILL(…)` from the TUI-capture lane's
 * audited set or `PENDING` for the honest empty stage — nothing is filmed
 * by hand and nothing is made up (`public/landing/tui/README.md`; workflow
 * contract in `docs/tui-capture-workflow.md`).
 *
 * Voice: `entry` is game-voice flavor — what the form IS, in the collector
 * register the wall art already speaks (generic creature-collector vocabulary
 * only; never a species name). `practice` is the real capability description,
 * and the router's job tally stays generated from `JOB_DEFS` through
 * `scripts/landing_claims.mjs`. `weakness` is the skeptic's pain the feature
 * answers, phrased as a dex weakness row.
 *
 * `DexSection` renders this list verbatim; `dex.test.tsx` pins the spine,
 * the screens and the derived tallies, `creature.test.tsx` pins that the
 * forms are exactly the eleven sprites.
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
  /** A stable slug, never a `CreatureId` — behaviors have no specimen. The
   * slug is also the deep-link handle (`#dex-<id>`), so it is URL-safe and
   * never renamed once shipped. */
  id: string;
  /** The screen this surface browses under — a behavior never joins the
   * session/engine split, so it declares its own. (Named `screen`, not
   * `category`: a form's `category` is its game-voice gloss, and one field
   * name must not mean two things across the union.) */
  screen: BehaviorCategory;
  /** One-line gloss under the name. */
  summary: string;
};

export type DexEntry = FormEntry | BehaviorEntry;

/* ------------------------------------------------------------------ */
/* the screens — the taxonomy that keeps a growing catalog browsable    */
/* ------------------------------------------------------------------ */

/**
 * The dex's screens. The spine stays ONE list — every entry keeps its
 * number for life — but the list is browsed a screen at a time, and a
 * screen is a category. Four exist today; adding one is a one-object edit
 * to `CATEGORY_DEFS`, and the selector row, the counts, the pools and the
 * deep-link landing all follow without another edit.
 *
 * A form's screen is its `type` — what runs where is already the split the
 * pane's badge prints — and a behavior declares its own `screen`, since
 * a filmed surface belongs to no single form. The mapping is pinned by
 * `dex.test.tsx`, so a taxonomy edit that strands an entry fails the run.
 */
export type DexCategory = "session" | "engine" | "workflow" | "extend";

/** The screens a behavior can belong to — it never joins the session/engine
 * split, which is the forms' own "where it runs" pair. */
export type BehaviorCategory = Exclude<DexCategory, "session" | "engine">;

export interface CategoryDef {
  id: DexCategory;
  /** The screen button's word, lowercase like the rest of the chrome. */
  label: string;
  /** What the screen holds, one line in the collector register — the
   * button's aria-label, so the gloss travels with the control. */
  gloss: string;
}

/** The category set, in the order the section lead names them. */
export const CATEGORY_DEFS: readonly CategoryDef[] = [
  { id: "session", label: "session", gloss: "what joins every session" },
  { id: "engine", label: "engine", gloss: "what runs while you are away" },
  { id: "workflow", label: "workflows", gloss: "the surfaces you drive" },
  { id: "extend", label: "configure", gloss: "what you point at your own work" },
];

/** `all` is a screen too — the default one: the whole spine, walkable end
 * to end, and the pool the search starts from. */
export type DexScreen = "all" | DexCategory;

/** The screen set in walk order — the selector row renders this verbatim. */
export const SCREENS: readonly DexScreen[] = [
  "all",
  ...CATEGORY_DEFS.map((c) => c.id),
];

/** A form's screen is its type; a behavior's is declared on the entry. */
export const screenOf = (e: DexEntry): DexCategory =>
  e.kind === "form" ? e.type : e.screen;

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

/**
 * The catalog itself. Entries carry NO hand-typed number — `no` is stamped
 * from array position at module load, which is the derive-don't-type rule
 * applied to the spine itself: appending an entry is a one-object edit and
 * the number it gets is the next one, never a choice, never a duplicate.
 * Reordering the array is the one edit that renumbers, and the spine's
 * order is part of the page's contract (the forms first, then the
 * behaviors) — `dex.test.tsx` pins both halves stay contiguous.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type DexEntryInput = DistributiveOmit<DexEntry, "no">;

const RAW: readonly DexEntryInput[] = [
  /* ---------------------------------------------------------------- */
  /* № 001-011 — the forms: drawn, catalogued, filmed where filmed      */
  /* ---------------------------------------------------------------- */
  {
    kind: "form",
    id: "websearch",
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
    // Captured 2026-10-24 (the pending-plates round): a real session asking a
    // stable-forever question through the keyless chain — web_search visibly
    // cascading providers, the answer arriving with its cited source.
    captures: [REEL("websearch", "01-session-with-question.png")],
  },
  {
    kind: "form",
    id: "mcp",
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
    // Captured 2026-10-24: a real MCP stdio server (the harness's own
    // fixtures/mini-mcp-dice.mjs — actual JSON-RPC initialize/tools/list/
    // tools/call) configured via `unown mcp add`, its tool arriving in the
    // session as dice/roll and called live.
    captures: [REEL("mcp", "01-session-with-ask.png")],
  },
  {
    kind: "form",
    id: "task",
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
    // Captured 2026-10-24: /repomap's graph-ranked map, then a cross-tree
    // rename while typescript-language-server's diagnostics ride every
    // edit's tool result (the PostToolUse feedback loop).
    captures: [REEL("lsp", "01-repomap.png")],
  },
  {
    kind: "form",
    id: "memory",
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
    // The memory-learn lane: two sessions in one pane — teach the house
    // rules + a real task, /note the lesson, /quit; AutoDream consolidates
    // behind the scenes; a fresh session boots with the learned memory (the
    // footer chip v0 → vN), /memory search recalls it as a scored result,
    // and the closing task applies the lesson unprompted (bun, the test
    // suite run twice, both tallies quoted).
    captures: [REEL("memory-learn", "01-fresh-session-v0.png")],
  },
  {
    kind: "form",
    id: "harness",
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
    // Captured 2026-10-24: the Learning Lab screen against the live engine
    // after a real cycle ran through POST /api/tasks/<id>/run — the
    // baseline run, the verify step and the mined-rule decision the screen
    // actually shows.
    captures: [REEL("harness", "01-learning-lab.png")],
  },
  {
    kind: "form",
    id: "router",
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
    // Captured 2026-10-24: the Router screen's real job table against the
    // live engine — dreams, harness, automations, one busy-mutex.
    captures: [REEL("router", "01-router-jobs.png")],
  },
  {
    kind: "form",
    id: "dream",
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
    // The dream-dashboard lane: `unown dashboard dreams` against the live
    // engine — the real dream rows (done/gated/error, notes → merged ·
    // pruned · added), the dream detail with its canary/guard note and
    // rendered output, and the Memory screen's four tiers + injection
    // budget.
    captures: [REEL("dream-dashboard", "01-dreams.png")],
  },
  {
    kind: "form",
    id: "hooks",
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
    // The 2026-10-24 media-completion round: the checklist's newest ports,
    // filmed live — one real task, /context (the context-window view), then
    // the session workflow end to end: /sessions list → /sessions export --md
    // → the exported markdown on disk → the machine-wide listing. The wiki
    // and the diagnostics clips stay catalogued as their own entries (№ 016,
    // № 017) rather than filed here as a catch-all; the filmed plate is the
    // sessions list itself — the face of the workflow this number counts.
    captures: [REEL("sdlc", "04-sessions-list.png")],
  },

  {
    kind: "form",
    id: "browser",
    name: "Browser",
    category: "the window form",
    type: "session",
    entry:
      "A living window that carries its own little page wherever it goes. It points at things with a golden claw, and the things obey. When the web asks whether it is human, it has learned to answer calmly.",
    weakness: "an agent that can read about the web but never touch it",
    practice: [
      "Drives a real Chromium over CDP — navigate, a11y-tree snapshots with element refs, trusted clicks and typing (isTrusted passes), forms in one call, tabs, downloads, cookies, console and network.",
      "Screenshots come back as image blocks the model sees directly — the vision loop grounds coordinate clicks against the picture. Auto-starts headless, keeps logins in a persistent profile, or attaches to the Chrome you are already logged into.",
      "Stealth tier: the Runtime domain is never enabled, so the 2026 CDP detection signal stays silent — verified live in both directions — while the browser itself applies a coherent fingerprint (real engine version, matching client hints, timezone, screen) and humanizes mouse paths and typing; stealth verify re-reads the live fingerprint: 10/10 coherent, and bot.sannysoft.com shows zero FAIL rows.",
      "Captcha tier: detect then solve Turnstile, reCAPTCHA, hCaptcha, DataDome, AWS WAF and image challenges — a native checkbox click first, then 2Captcha/CapSolver, then vision OCR on the repo's own Agnes preset (verified reading a live captcha); the vendor gaps are stated, not faked.",
      "Zero new runtime dependencies: the protocol is spoken directly over the runtime's native WebSocket, so the compiled binaries stay a closed graph.",
      "The browser SUBAGENT: delegate the whole flow (task agent=browser, sync or async) and the child holds every snapshot, screenshot and console line in its own context — you get back a compact verified report on a 10-minute budget. The 2026 consensus shape (Gemini's browser_agent, Cursor's Browser subagent): DOM trees are context poison, so the browser surface ships as a subagent.",
    ],
    habitat: "joins every session",
    receipts: [
      ["browser session", SRC("browser/session.ts")],
      ["browser stealth", SRC("browser/stealth.ts")],
      ["browser captcha", SRC("browser/captcha.ts")],
      ["browser tools", SRC("browser/tools.ts")],
      ["docs/browser.md", DOC("docs/browser.md")],
      ["stealth live tests", SRC("../test/browser-stealth-live.test.ts")],
    ],
    // The browser-verify lane: the visitor check — the agent opens the
    // landing page on the local dev server with its browser tool (web
    // navigate → a11y snapshot), finds the exact curl install command,
    // clicks the GitHub link, screenshots where it landed, and reports.
    // The browser-subagent lane (2026-10-24, the filmed cut of the old PTY
    // stills): the same surface delegated — the task → browser row, the
    // HUMANIZED live labels riding it (browser: navigate / fill_form /
    // click), the child's report back, then the async lane: the ◉ fleet
    // widget row and the /tasks lifecycle registry.
    captures: [
      REEL("browser-verify", "01-session.png", "visitor check"),
      REEL("browser-subagent", "03-live-browser.png", "subagent"),
    ],
  },

  /* ---------------------------------------------------------------- */
  /* № 012-022 — the behaviors: filmed, not drawn                       */
  /* ---------------------------------------------------------------- */
  {
    kind: "behavior",
    id: "fix-loop",
    screen: "workflow",
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
    screen: "workflow",
    name: "Plan mode",
    summary: "read-only until you approve",
    practice: [
      "Read-only until approved: /plan drafts the numbered plan, the approval overlay hands execution over, and the plan runs to completion.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    // The poster is the lane's SECOND audited still — the numbered plan
    // itself, the story's face. The first still is the shared boot frame,
    // byte-identical to the hero lane's (same fresh-session pane, same
    // fixture): as a poster it read as a broken duplicate, and two entries
    // must never ship the same face.
    captures: [REEL("plan-mode", "02-plan-mode-on.png")],
  },
  {
    kind: "behavior",
    id: "checkpoints",
    screen: "workflow",
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
    screen: "workflow",
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
    screen: "workflow",
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
    screen: "workflow",
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
    screen: "workflow",
    name: "Split view",
    summary: "the display mode's own band, dock and transcript",
    practice: [
      "A Thinking panel and a Tool Usage band across the top, a Files dock with its edit-diff subpanel on the right, a response-only transcript. A built-in port of pi-split-view 1.1.0, shipped with every session. Filmed 2026-10-24: a live turn filling the band while the dock carries the diff.",
    ],
    receipts: [["docs/split-view.md", DOC("docs/split-view.md")]],
    captures: [REEL("split-view", "01-split-band.png")],
  },
  {
    kind: "behavior",
    id: "goals",
    screen: "extend",
    name: "Goals",
    summary: "objectives closed against cited evidence",
    practice: [
      "A durable objective the session completes against cited evidence — the usage docs' goals section carries the rules.",
    ],
    receipts: [["docs/usage.md", DOC("docs/usage.md")]],
    // Captured 2026-10-24: a real /goal run — the objective injection, the
    // todo-tracked work, the [GOAL:COMPLETE] gate passing on both kinds of
    // cited evidence, and the /goal status showing the record.
    captures: [REEL("goals", "01-goal-set.png")],
  },
  {
    kind: "behavior",
    id: "routines",
    screen: "extend",
    name: "Routines",
    summary: "recurring runs on real recurrence semantics",
    practice: [
      "Recurring runs on real recurrence semantics — docs/routines.md is the decision record.",
    ],
    receipts: [["docs/routines.md", DOC("docs/routines.md")]],
    // Captured 2026-10-24: the full routines manager against the live
    // engine, with a real routine created through the CLI (a daily 09:00
    // morning brief, read-only) and its history row.
    captures: [REEL("routines", "01-routines-manager.png")],
  },
  {
    kind: "behavior",
    id: "skills",
    screen: "extend",
    name: "Skills",
    summary: "instruction files loaded on demand",
    practice: [
      "Instruction files the session loads on demand — docs/skills.md has the surface.",
    ],
    receipts: [["docs/skills.md", DOC("docs/skills.md")]],
    // Captured 2026-10-24: the Skills screen against the live engine after
    // the harness loop actually shipped a skill — the row the loop minted,
    // not a mock.
    captures: [REEL("skills", "01-skills-shipped.png")],
  },
  {
    kind: "behavior",
    id: "parity-round",
    screen: "workflow",
    name: "The parity round",
    summary: "the 2026 consensus workflows, ported and live-verified",
    practice: [
      "The side-question lane (/btw): one answer about the session in a dismissible overlay — never entering the transcript, the receipts ledger or AutoDream's note mining (the Claude Code / Antigravity / OpenCode consensus, ported).",
      "The persona layer (/output-style): four built-ins plus custom .unown/styles/*.md, the directive riding the system prompt from the next message.",
      "Cross-session analytics (/insights): sessions, top models/projects, most-touched files from receipts, tool usage, token totals, friction — everything local.",
      "Session auto-titles after the first settled turn, long-turn OSC-9 attention, and unown sessions import --from claude|codex — the migration moat off Claude Code and Codex histories.",
    ],
    receipts: [
      ["btw.ts", SRC("btw.ts")],
      ["output-style.ts", SRC("output-style.ts")],
      ["insights.ts", SRC("insights.ts")],
      ["auto-title.ts", SRC("auto-title.ts")],
      ["import-convert.ts", SRC("import-convert.ts")],
      ["docs/usage.md", DOC("docs/usage.md")],
    ],
    // Captured 2026-10-24: one live session walking the consensus round —
    // the style listing and set, the /btw overlay answering from context,
    // the /insights report, and the auto-titled session proven by /name.
    captures: [REEL("parity-round", "01-output-styles.png")],
  },
];

/** The numbered spine — `RAW` in walk order, each entry stamped with its
 * position. This is the ONE catalog export the band renders; every figure,
 * screen pool and lookup below reduces over it. (The cast is the price of a
 * distributive Omit: the spread of a union widens in TS, while the runtime
 * shape is exactly `DexEntry` — `no` added, nothing else touched.) */
export const DEX: readonly DexEntry[] = RAW.map(
  (entry, i) => ({ ...entry, no: String(i + 1).padStart(3, "0") }) as DexEntry,
);

/** Every screen's pool, derived. A category that grows is a pool that
 * grows; nothing else on the page moves. */
export const DEX_BY_CATEGORY: ReadonlyMap<
  DexCategory,
  readonly DexEntry[]
> = new Map(
  CATEGORY_DEFS.map(
    (c) => [c.id, DEX.filter((e) => screenOf(e) === c.id)] as const,
  ),
);

/** The pool a screen walks — `all` is the whole spine. */
export const poolFor = (screen: DexScreen): readonly DexEntry[] =>
  screen === "all" ? DEX : (DEX_BY_CATEGORY.get(screen) ?? []);

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

/** The spelled-out tally sentence the band's lead prints. The still-set
 *  phrase pluralizes with its count ("1 still set", "0 still sets") — the
 *  2026-10-24 media-completion round left zero still lanes in the mix, and
 *  the derived sentence has to read like English at every count. */
export const TALLY_SENTENCE =
  `${TALLY.filmed} of ${TALLY.total} carry a capture — ${TALLY.videos} movies, ` +
  `${TALLY.stills === 1 ? "1 still set" : `${TALLY.stills} still sets`}, ` +
  `${TALLY.pending} pending. Nothing here was filmed by hand.`;
