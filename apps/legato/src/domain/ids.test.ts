/**
 * ids.ts tests — deterministic integer id allocation (max+1, no reuse
 * within a store generation, pure function over the data set).
 */
import { test, expect } from "bun:test";
import type { LegatoData, Clip } from "./types.js";
import { nextClipId, nextHighlightId, nextId } from "./ids.js";

function makeClip(id: number, highlights: import("./types.js").Highlight[] = []): Clip {
  return {
    id,
    url: "https://example.com",
    title: "Example",
    text: "body",
    tags: [],
    state: "unread",
    highlights,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  };
}

function makeData(clips: Clip[]): LegatoData {
  const tagSet = new Set<string>();
  for (const c of clips) for (const t of c.tags) tagSet.add(t);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips,
    tags: [...tagSet].sort(),
    queue: clips.map((c) => c.id),
  };
}

test("nextClipId on empty store returns 1", () => {
  const data = makeData([]);
  expect(nextClipId(data)).toBe(1);
});

test("nextClipId returns max + 1", () => {
  const data = makeData([makeClip(3), makeClip(7), makeClip(5)]);
  expect(nextClipId(data)).toBe(8);
});

test("nextHighlightId on store with no highlights returns 1", () => {
  const data = makeData([makeClip(1)]);
  expect(nextHighlightId(data)).toBe(1);
});

test("nextHighlightId returns max highlight id + 1", () => {
  const hl = (id: number): import("./types.js").Highlight => ({
    id,
    clipId: 1,
    anchor: "a",
    quote: "q",
    createdAt: "2026-11-07T00:00:00.000Z",
  });
  const data = makeData([makeClip(1, [hl(10), hl(20)])]);
  expect(nextHighlightId(data)).toBe(21);
});

test("nextId returns the shared-space max + 1", () => {
  const hl = { id: 50, clipId: 1, anchor: "a", quote: "q", createdAt: "2026-11-07T00:00:00.000Z" };
  const data = makeData([makeClip(5, [hl as import("./types.js").Highlight])]);
  // clip id 5, highlight id 50 → nextId = 51
  expect(nextId(data)).toBe(51);
});

test("id allocation is deterministic (pure function over data)", () => {
  const data = makeData([makeClip(42), makeClip(41)]);
  const a = nextClipId(data);
  const b = nextClipId(data);
  expect(a).toBe(43);
  expect(b).toBe(43); // same input → same output, no side effects
});
