/**
 * invariants.ts tests — one pin per invariant class (breach table).
 */
import { test, expect } from "bun:test";
import type { LegatoData } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

function makeClip(overrides: Partial<import("./types.js").Clip> = {}): import("./types.js").Clip {
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

function makeData(overrides: Partial<LegatoData> = {}): LegatoData {
  const clip = makeClip();
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [clip],
    tags: [],
    queue: [1],
    ...overrides,
  };
}

/** Helper: assert that assertData throws a DomainInvariantError. */
function expectBreach(data: LegatoData, msgIncludes?: string) {
  try {
    assertData(data);
    throw new Error("expected DomainInvariantError but assertData did not throw");
  } catch (e) {
    expect(e).toBeInstanceOf(DomainInvariantError);
    if (msgIncludes) {
      expect((e as Error).message.toLowerCase()).toContain(msgIncludes.toLowerCase());
    }
  }
}

test("invariant: valid data asserts clean", () => {
  expect(() => assertData(makeData())).not.toThrow();
});

test("invariant: duplicate clip id", () => {
  const c = makeClip();
  expectBreach(
    makeData({ clips: [c, { ...c }], queue: [1, 1] }),
    "duplicate clip id",
  );
});

test("invariant: non-integer clip id", () => {
  const c = makeClip({ id: 1.5 });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "integer",
  );
});

test("invariant: empty url", () => {
  const c = makeClip({ url: "" });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "url",
  );
});

test("invariant: empty title", () => {
  const c = makeClip({ title: "" });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "title",
  );
});

test("invariant: invalid state", () => {
  const c = makeClip({ state: "invalid" as import("./types.js").ClipState });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "state",
  );
});

test("invariant: invalid error value", () => {
  const c = makeClip({ error: "bogus" as import("./types.js").ClipError });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "error",
  );
});

test("invariant: non-ISO createdAt", () => {
  const c = makeClip({ createdAt: "not-a-date" });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "createdAt",
  );
});

test("invariant: non-ISO updatedAt", () => {
  const c = makeClip({ updatedAt: "yesterday" });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "updatedAt",
  );
});

test("invariant: highlight clipId does not resolve", () => {
  const c = makeClip({
    highlights: [{
      id: 11,
      clipId: 99,
      anchor: "a",
      quote: "q",
      createdAt: "2026-11-07T00:00:00.000Z",
    }],
  });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "clipId",
  );
});

test("invariant: duplicate highlight id", () => {
  const hl = {
    id: 11,
    clipId: 1,
    anchor: "a",
    quote: "q",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const c = makeClip({ highlights: [hl, { ...hl }], });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "duplicate highlight id",
  );
});

test("invariant: highlight non-integer id", () => {
  const c = makeClip({
    highlights: [{
      id: 0,
      clipId: 1,
      anchor: "a",
      quote: "q",
      createdAt: "2026-11-07T00:00:00.000Z",
    }],
  });
  expectBreach(
    makeData({ clips: [c], queue: [1] }),
    "integer",
  );
});

test("invariant: data.tags lists a tag not in any clip", () => {
  const c = makeClip({ tags: ["a"] });
  expectBreach(
    makeData({ clips: [c], tags: ["a", "b"], queue: [1] }),
    "not present in any clip",
  );
});

test("invariant: data.tags missing a tag present in clips", () => {
  const c = makeClip({ tags: ["a", "b"] });
  expectBreach(
    makeData({ clips: [c], tags: ["a"], queue: [1] }),
    "missing tag",
  );
});

test("invariant: duplicate entry in data.tags", () => {
  const c = makeClip({ tags: ["a"] });
  expectBreach(
    makeData({ clips: [c], tags: ["a", "a"], queue: [1] }),
    "duplicate",
  );
});

test("invariant: data.queue lists unknown clip id", () => {
  const c = makeClip();
  expectBreach(
    makeData({ clips: [c], tags: [], queue: [1, 2] }),
    "does not resolve",
  );
});

test("invariant: clip missing from data.queue", () => {
  const c = makeClip({ id: 2 });
  const c1 = makeClip({ id: 1 });
  expectBreach(
    makeData({ clips: [c1, c], tags: [], queue: [1] }),
    "missing from data.queue",
  );
});

test("invariant: duplicate entry in data.queue", () => {
  const c = makeClip();
  expectBreach(
    makeData({ clips: [c], tags: [], queue: [1, 1] }),
    "duplicate",
  );
});
