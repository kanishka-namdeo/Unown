/**
 * types.ts tests — the `legato.v1` grammar round-trip pin.
 *
 * A canonical clip JSON parses and asserts clean; the closed enum
 * sets are exercised at their type level.
 */
import { test, expect } from "bun:test";
import type { Clip, ClipState, ClipError, LegatoData, Highlight } from "./types.js";
import { DomainInvariantError, QuotaExceededError, MigrationError } from "./types.js";
import { assertData } from "./invariants.js";
import { nextClipId, nextHighlightId, nextId } from "./ids.js";

/** A minimal valid clip used across the test file. */
function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    url: "https://example.com",
    title: "Example",
    text: "body",
    tags: [],
    state: "unread",
    highlights: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

/** A minimal valid LegatoData with one clip. */
function makeData(clipOverrides: Partial<Clip> = {}): LegatoData {
  const clip = makeClip(clipOverrides);
  const tags = new Set(clip.tags);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [clip],
    tags: [...tags].sort(),
    queue: [clip.id],
  };
}

test("canonical clip JSON parses and asserts clean", () => {
  const json = JSON.stringify(makeData({ title: "Hello", text: "world" }));
  const parsed = JSON.parse(json) as LegatoData;
  // No invariant breach — should not throw
  expect(() => assertData(parsed)).not.toThrow();
});

test("full clip with every optional field asserts clean", () => {
  const highlight: Highlight = {
    id: 11,
    clipId: 1,
    anchor: "context around the quote",
    quote: "the quote itself",
    note: "a note",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const data = makeData({
    finalUrl: "https://example.com/final",
    excerpt: "the excerpt",
    paywallExcerptOnly: true,
    emptyText: false,
    jsWalled: false,
    tags: ["a", "b"],
    highlights: [highlight],
    error: "paywalled",
  });
  // Rebuild tags/queue to match the clip
  data.tags = ["a", "b"];
  data.queue = [1];
  expect(() => assertData(data)).not.toThrow();
});

test("ClipState closed set — all four values accepted", () => {
  const states: ClipState[] = ["unread", "reading", "done", "archived"];
  for (const s of states) {
    const data = makeData({ state: s });
    expect(() => assertData(data)).not.toThrow();
  }
});

test("ClipError closed set — all seven values accepted", () => {
  const errors: ClipError[] = [
    "charset-unknown", "redirect-loop", "js-walled", "paywalled",
    "oversized", "empty-text", "fetch-failed",
  ];
  for (const e of errors) {
    const data = makeData({ error: e });
    expect(() => assertData(data)).not.toThrow();
  }
});

test("DomainInvariantError carries the message", () => {
  const err = new DomainInvariantError("test breach");
  expect(err.name).toBe("DomainInvariantError");
  expect(err.message).toBe("test breach");
});

test("QuotaExceededError carries the message", () => {
  const err = new QuotaExceededError("out of space");
  expect(err.name).toBe("QuotaExceededError");
  expect(err.message).toBe("out of space");
});

test("MigrationError carries the message", () => {
  const err = new MigrationError("unknown version");
  expect(err.name).toBe("MigrationError");
  expect(err.message).toBe("unknown version");
});
