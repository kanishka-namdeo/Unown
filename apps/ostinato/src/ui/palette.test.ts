/**
 * O-4 chunk 2 — the command palette enumeration test pin (Lane A —
 * DOM-free, runs under `cd apps/ostinato && bun test`). The file
 * that should have existed since O-3: palette.ts's claimed command
 * count was NEVER asserted anywhere (grep: no palette.test.ts). This
 * suite pins the whole enumeration:
 *
 *   - the 19-command count (the dropped-row guard; grew 18→19 with R-2's deck-settings)
 *   - id uniqueness + PALETTE_BY_ID totality
 *   - group membership + render-order law (PALETTE_GROUPS order)
 *   - the two create rows (create-deck / create-card, group "data",
 *     hints N / C, enabled in EVERY phase — D1's law)
 *   - isCommandEnabled semantics on the classic rows
 *   - filterCommands: full table on empty query, exact narrowing,
 *     case-insensitivity, id/label/group/hint substring matching
 *   - COMMAND_KEY_DISPATCH: n/N → create-deck, c/C → create-card,
 *     the classic mappings, and the dispatch total (every value is a
 *     real PALETTE_BY_ID key)
 *   - GRADE_COMMAND_ID: 1–4 → the four grade rows, each a real id
 *   - hint honesty spot-checks
 */
import { test, expect } from "bun:test";
import {
  PALETTE_COMMANDS,
  PALETTE_BY_ID,
  PALETTE_GROUPS,
  PALETTE_COMMAND_COUNT,
  isCommandEnabled,
  filterCommands,
  COMMAND_KEY_DISPATCH,
  GRADE_COMMAND_ID,
} from "./palette.js";

type Phase = "front" | "revealed" | "done";

// ─── Enumeration shape ─────────────────────────────────────────────────

test("PALETTE_COMMAND_COUNT === 19 (the dropped-row guard)", () => {
  expect(PALETTE_COMMAND_COUNT).toBe(19);
  expect(PALETTE_COMMANDS.length).toBe(19);
});

test("every command id is UNIQUE (19 rows → 19 distinct ids)", () => {
  const ids = PALETTE_COMMANDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(19);
});

test("PALETTE_BY_ID contains every row (19 keys, each mapping to its row)", () => {
  expect(Object.keys(PALETTE_BY_ID).length).toBe(19);
  for (const cmd of PALETTE_COMMANDS) {
    expect(PALETTE_BY_ID[cmd.id]).toBe(cmd);
  }
});

test("every row's group ∈ PALETTE_GROUPS and rows render in PALETTE_GROUPS order", () => {
  const groupSet = new Set(PALETTE_GROUPS);
  for (const cmd of PALETTE_COMMANDS) {
    expect(groupSet.has(cmd.group)).toBe(true);
  }
  // The table's group sequence, after collapsing runs, must equal the
  // PALETTE_GROUPS order (review, navigate, filter, data, app).
  const seen: string[] = [];
  for (const cmd of PALETTE_COMMANDS) {
    if (seen[seen.length - 1] !== cmd.group) seen.push(cmd.group);
  }
  expect(seen).toEqual([...PALETTE_GROUPS]);
});

// ─── The two create rows (O-4 chunk 2) ─────────────────────────────────

test("create-deck + create-card: present, group \"data\", hints N / C", () => {
  const deck = PALETTE_BY_ID["create-deck"];
  const card = PALETTE_BY_ID["create-card"];
  expect(deck).toBeDefined();
  expect(card).toBeDefined();
  expect(deck.group).toBe("data");
  expect(card.group).toBe("data");
  expect(deck.hint).toBe("N");
  expect(card.hint).toBe("C");
});

test("create rows are enabled in EVERY phase (D1's law: a fresh deck/card recomputes the queue)", () => {
  const phases: Phase[] = ["front", "revealed", "done"];
  for (const phase of phases) {
    expect(isCommandEnabled(PALETTE_BY_ID["create-deck"], phase)).toBe(true);
    expect(isCommandEnabled(PALETTE_BY_ID["create-card"], phase)).toBe(true);
  }
});

// ─── isCommandEnabled semantics on the classic rows ────────────────────

test("grade-* rows: disabled in \"front\" and \"done\", enabled in \"revealed\"", () => {
  const grades = ["grade-again", "grade-hard", "grade-good", "grade-easy"];
  for (const id of grades) {
    expect(isCommandEnabled(PALETTE_BY_ID[id], "front")).toBe(false);
    expect(isCommandEnabled(PALETTE_BY_ID[id], "revealed")).toBe(true);
    expect(isCommandEnabled(PALETTE_BY_ID[id], "done")).toBe(false);
  }
});

test("reveal: disabled in \"revealed\" and \"done\", enabled in \"front\"", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["reveal"], "front")).toBe(true);
  expect(isCommandEnabled(PALETTE_BY_ID["reveal"], "revealed")).toBe(false);
  expect(isCommandEnabled(PALETTE_BY_ID["reveal"], "done")).toBe(false);
});

test("restart/search/export/import/clear-session + create rows: enabled everywhere", () => {
  const alwaysOn = [
    "restart",
    "search",
    "export",
    "import",
    "clear-session",
    "create-deck",
    "create-card",
    "stats",
  ];
  for (const id of alwaysOn) {
    for (const phase of ["front", "revealed", "done"] as Phase[]) {
      expect(isCommandEnabled(PALETTE_BY_ID[id], phase)).toBe(true);
    }
  }
});

test("skip: disabled only in \"done\"", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["skip"], "front")).toBe(true);
  expect(isCommandEnabled(PALETTE_BY_ID["skip"], "revealed")).toBe(true);
  expect(isCommandEnabled(PALETTE_BY_ID["skip"], "done")).toBe(false);
});

// ─── filterCommands ─────────────────────────────────────────────────────

test("filterCommands: empty/null/undefined query → the full 19", () => {
  expect(filterCommands("")).toHaveLength(19);
  expect(filterCommands(null)).toHaveLength(19);
  expect(filterCommands(undefined)).toHaveLength(19);
});

test("filterCommands: \"create\" → exactly the two create rows, in table order", () => {
  const hits = filterCommands("create");
  expect(hits.map((c) => c.id)).toEqual(["create-deck", "create-card"]);
});

test("filterCommands: \"grade\" → the four grade rows", () => {
  const hits = filterCommands("grade");
  expect(hits.map((c) => c.id)).toEqual([
    "grade-again",
    "grade-hard",
    "grade-good",
    "grade-easy",
  ]);
});

test("filterCommands: matching is case-insensitive (\"EXPORT\" finds export)", () => {
  const hits = filterCommands("EXPORT");
  expect(hits.map((c) => c.id)).toContain("export");
});

test("filterCommands: matches on id, label, group, AND hint substrings", () => {
  expect(filterCommands("data").map((c) => c.id)).toEqual([
    "create-deck",
    "create-card",
    "export",
    "import",
    "deck-settings",
  ]); // group match (R-2 added deck-settings to the group)
  expect(filterCommands("json").map((c) => c.id)).toEqual([
    "export",
    "import",
  ]); // label match
  expect(filterCommands("ctrl").map((c) => c.id)).toEqual([
    "export",
    "import",
    "clear-session",
  ]); // hint match
  expect(filterCommands("next-card").length).toBe(1); // id match
});

test("filterCommands: a non-matching query → []", () => {
  expect(filterCommands("zebra")).toEqual([]);
});

// ─── COMMAND_KEY_DISPATCH ───────────────────────────────────────────────

test("COMMAND_KEY_DISPATCH: n/N → create-deck, c/C → create-card", () => {
  expect(COMMAND_KEY_DISPATCH["n"]).toBe("create-deck");
  expect(COMMAND_KEY_DISPATCH["N"]).toBe("create-deck");
  expect(COMMAND_KEY_DISPATCH["c"]).toBe("create-card");
  expect(COMMAND_KEY_DISPATCH["C"]).toBe("create-card");
});

test("COMMAND_KEY_DISPATCH: d/D → deck-settings (R-2)", () => {
  expect(COMMAND_KEY_DISPATCH["d"]).toBe("deck-settings");
  expect(COMMAND_KEY_DISPATCH["D"]).toBe("deck-settings");
});

test("COMMAND_KEY_DISPATCH: the classic mappings", () => {
  expect(COMMAND_KEY_DISPATCH["s"]).toBe("skip");
  expect(COMMAND_KEY_DISPATCH["S"]).toBe("skip");
  expect(COMMAND_KEY_DISPATCH["r"]).toBe("restart");
  expect(COMMAND_KEY_DISPATCH["R"]).toBe("restart");
  expect(COMMAND_KEY_DISPATCH["j"]).toBe("next-card");
  expect(COMMAND_KEY_DISPATCH["k"]).toBe("prev-card");
  expect(COMMAND_KEY_DISPATCH["g"]).toBe("first-card");
  expect(COMMAND_KEY_DISPATCH["G"]).toBe("last-card");
  expect(COMMAND_KEY_DISPATCH["/"]).toBe("search");
});

test("COMMAND_KEY_DISPATCH: every VALUE is a real PALETTE_BY_ID key (dispatch total)", () => {
  for (const target of Object.values(COMMAND_KEY_DISPATCH)) {
    expect(PALETTE_BY_ID[target]).toBeDefined();
  }
});

// ─── GRADE_COMMAND_ID ───────────────────────────────────────────────────

test("GRADE_COMMAND_ID: 1→again, 2→hard, 3→good, 4→easy; every value is a real row id", () => {
  expect(GRADE_COMMAND_ID[1]).toBe("grade-again");
  expect(GRADE_COMMAND_ID[2]).toBe("grade-hard");
  expect(GRADE_COMMAND_ID[3]).toBe("grade-good");
  expect(GRADE_COMMAND_ID[4]).toBe("grade-easy");
  for (const id of Object.values(GRADE_COMMAND_ID)) {
    expect(PALETTE_BY_ID[id]).toBeDefined();
  }
});

// ─── Hint honesty spot-checks ───────────────────────────────────────────

test("hint honesty: export \"Ctrl+E\", import \"Ctrl+O\", clear-session \"Ctrl+X\", reveal \"Space / Enter\"", () => {
  expect(PALETTE_BY_ID["export"].hint).toBe("Ctrl+E");
  expect(PALETTE_BY_ID["import"].hint).toBe("Ctrl+O");
  expect(PALETTE_BY_ID["clear-session"].hint).toBe("Ctrl+X");
  expect(PALETTE_BY_ID["reveal"].hint).toBe("Space / Enter");
});
