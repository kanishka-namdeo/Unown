/**
 * migration.ts tests — the migration-frame refusal pin and the
 * v1→v2 design-note carrier (S-1/S-4 edge register rows).
 */
import { test, expect } from "bun:test";
import type { LegatoData } from "../domain/types.js";
import { MigrationError } from "../domain/types.js";
import { assertData } from "../domain/invariants.js";
import { migrate, SUPPORTED_VERSIONS, MIGRATION_NOTES } from "./migration.js";

function makeData(overrides: Partial<LegatoData> = {}): LegatoData {
  const clip = {
    id: 1,
    url: "https://example.com",
    title: "Example",
    text: "body",
    tags: ["a"],
    state: "unread" as const,
    highlights: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  };
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [clip],
    tags: ["a"],
    queue: [1],
    ...overrides,
  };
}

test("migration frame: v1 migrates cleanly (the frame's known version)", () => {
  const data = makeData();
  const out = migrate(data, 1);
  // output asserts clean — migration preserves invariants (S-1)
  expect(() => assertData(out)).not.toThrow();
  expect(out.schema).toBe("legato.v1");
});

test("migration frame: output is a structural copy (input untouched)", () => {
  const data = makeData();
  const out = migrate(data, 1);
  out.clips[0].title = "MUTATED";
  expect(data.clips[0].title).toBe("Example");
});

// --- the migration-frame refusal pin: unknown/future version → typed error ---

test("migration frame refusal: unknown version 0 throws MigrationError", () => {
  expect(() => migrate(makeData(), 0)).toThrow(MigrationError);
});

test("migration frame refusal: future version 3 throws MigrationError", () => {
  expect(() => migrate(makeData(), 3)).toThrow(MigrationError);
});

test("migration frame refusal: negative version throws MigrationError", () => {
  expect(() => migrate(makeData(), -1)).toThrow(MigrationError);
});

test("migration frame refusal: the error is typed and names the version", () => {
  try {
    migrate(makeData(), 42);
    throw new Error("expected MigrationError");
  } catch (e) {
    expect(e).toBeInstanceOf(MigrationError);
    expect((e as Error).name).toBe("MigrationError");
    expect((e as Error).message).toContain("42");
  }
});

test("migration frame refusal: refusal never touches the input data", () => {
  const data = makeData();
  try {
    migrate(data, 99);
  } catch {
    /* expected refusal */
  }
  expect(data.schemaVersion).toBe(1); // input intact
  expect(data.schema).toBe("legato.v1");
});

test("SUPPORTED_VERSIONS carries exactly v1 (the only landed version)", () => {
  expect(SUPPORTED_VERSIONS.has(1)).toBe(true);
  expect(SUPPORTED_VERSIONS.has(2)).toBe(false);
  expect(SUPPORTED_VERSIONS.has(3)).toBe(false);
});

test("MIGRATION_NOTES: the v1→v2 named design note (W3 retention axis)", () => {
  expect(MIGRATION_NOTES[1]).toBeDefined();
  // the note names the honest limitation (PLAN risk #2)
  expect(MIGRATION_NOTES[1]).toContain("W3");
  expect(MIGRATION_NOTES[1]).toContain("quota");
});

test("migration frame: S-1 pre-migration dataset → migrate → invariants hold", () => {
  const data = makeData({
    clips: [
      {
        id: 1,
        url: "https://example.com/a",
        title: "A",
        text: "text-a",
        tags: ["shared", "a"],
        state: "done" as const,
        highlights: [
          {
            id: 11,
            clipId: 1,
            anchor: "around",
            quote: "the quote",
            note: "n",
            createdAt: "2026-11-07T00:00:00.000Z",
          },
        ],
        createdAt: "2026-11-07T00:00:00.000Z",
        updatedAt: "2026-11-07T00:01:00.000Z",
      },
      {
        id: 2,
        url: "https://example.com/b",
        title: "B",
        text: "text-b",
        tags: ["shared", "b"],
        state: "unread" as const,
        highlights: [],
        createdAt: "2026-11-07T00:00:00.000Z",
        updatedAt: "2026-11-07T00:02:00.000Z",
        error: "js-walled" as const,
      },
    ],
    tags: ["a", "b", "shared"],
    queue: [2, 1],
  });
  expect(() => assertData(data)).not.toThrow(); // pre-migration data is valid
  const out = migrate(data, 1);
  expect(() => assertData(out)).not.toThrow(); // invariants survive migration
  expect(out.clips).toHaveLength(2);
  expect(out.queue).toEqual([2, 1]); // order preserved
});
