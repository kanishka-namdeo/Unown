/**
 * The TUI addon catalog for the showcase band's addons strip.
 *
 * The engine ships three terminal addons
 * (pi-repo/packages/self-learning/src/addons/): ask_user_question, todo and
 * advisor — inline extensions whose every setting is user config in
 * ~/.unown/agent/addons.json, editable live through the /addons TUI menu.
 *
 * Sourcing contract: `ADDON_KEYS` mirrors the addon-config interfaces in
 * addons/config.ts leaf key by leaf key, and `ADDON_KEY_COUNT` derives from
 * it, so the figure the page prints is read off a list, never typed.
 * `__tests__/addons.test.tsx` re-reads config.ts and fails the run when the
 * two disagree — a key added to the engine without this file (or vice versa)
 * is a red test, not a stale caption. Same wiring as engine-data.ts's
 * generated job counts, enforced in the component suite instead of a CI
 * script because the config surface is one file away, not a whole directory
 * of receipts.
 *
 * The capability DEX owns the ten creatures' copy (dex-data.ts); this file
 * owns the addon framework. Facts once, each in its own home.
 */

export type AddonEntry = {
  /** The addon's name, exactly as the TUI and the config file print it. */
  name: string;
  /** One-line pitch — every clause is verifiable in the receipt file. */
  pitch: string;
  /** Receipt: [label, GitHub href] straight at the file that ships it. */
  receipt: readonly [string, string];
};

const SRC = (file: string) =>
  `https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/src/addons/${file}`;

export const ADDONS: readonly AddonEntry[] = [
  {
    name: "ask_user_question",
    pitch:
      "Up to four structured questions in one tabbed dialog, a free-text row on every question, a submit-review tab before anything is sent. The session blocks until you answer.",
    receipt: ["ask-user-question.ts", SRC("ask-user-question.ts")],
  },
  {
    name: "todo",
    pitch:
      "A four-state task machine (pending, in_progress, completed, deleted) with blockedBy dependencies that reject cycles, a live panel above the editor, and a /todos command.",
    receipt: ["todo.ts", SRC("todo.ts")],
  },
  {
    name: "advisor",
    pitch:
      "A second model watches the session and sends terse advice mid-run: nits queue as asides, concerns and blockers steer immediately. Read-only verification tools, an emission guard against noise, off by default.",
    receipt: ["advisor.ts", SRC("advisor.ts")],
  },
];

/**
 * The user-tunable leaf keys of ~/.unown/agent/addons.json, per addon, in the
 * order the interfaces declare them in addons/config.ts. `guidance` is
 * expanded to its three sub-keys because those are the keys a user writes.
 * The map is the source of `ADDON_KEY_COUNT` — nothing else may state a
 * count.
 */
export const ADDON_KEYS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "askUserQuestion",
    [
      "enabled",
      "collapseKey",
      "guidance.description",
      "guidance.promptSnippet",
      "guidance.promptGuidelines",
    ],
  ],
  [
    "todo",
    [
      "enabled",
      "maxWidgetLines",
      "collapseKey",
      "guidance.description",
      "guidance.promptSnippet",
      "guidance.promptGuidelines",
    ],
  ],
  [
    "advisor",
    [
      "enabled",
      "model",
      "thinkingLevel",
      "reviewMode",
      "reviewInterval",
      "maxNotesPerUpdate",
      "immuneTurns",
      "continueSeverity",
      "instructions",
      "showStatus",
    ],
  ],
]);

/** The figure the page prints — derived from `ADDON_KEYS`, never typed. */
export const ADDON_KEY_COUNT = [...ADDON_KEYS.values()].reduce(
  (n, keys) => n + keys.length,
  0,
);

/** Receipts for the config-surface copy: the file, and the /addons
 *  configurator that edits it. */
export const ADDONS_SURFACE_RECEIPTS: readonly (readonly [string, string])[] =
  [
    ["addons/config.ts", SRC("config.ts")],
    ["addons/index.ts", SRC("index.ts")],
  ];
