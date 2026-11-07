/**
 * clip.ts tests — the orchestrator pins (L-3 deliverable #4 + #8).
 *
 * One test per taxonomy entry, all over FakeFetcher (the unit-lane
 * doubles, PLAN §6.1 "no real network is touched by any unit
 * lane"). The Clip shape is asserted on every record: id via
 * ids.ts, state unread, timestamps ISO, the degraded fields honest.
 *
 * LANE SPLIT: the extractor's default parser (DOMParser) is only
 * available in a DOM runtime. The orchestrator tests split:
 *   - taxonomy lanes that SHORT-CIRCUIT before extraction
 *     (T-1 charset, T-2 redirect-loop, T-3 walls, T-7 reject)
 *     run in BOTH lanes — no extraction is performed.
 *   - lanes that REACH the extractor (clean, T-4 paywalled,
 *     T-5 oversized, T-6 empty-article) run under a DOM-guard
 *     (Lane A: honest skip stub; Lane B: real DOMParser run),
 *     the ostinato el-pin precedent.
 */
import { test, expect } from "bun:test";
import type { Clip, LegatoData } from "../domain/types.js";
import { assertData } from "../domain/invariants.js";
import { FakeFetcher } from "./fetcher.js";
import { clipUrl } from "./clip.js";

/** An empty-but-valid store view (the ids.ts allocation target). */
function emptyData(): LegatoData {
  return { schema: "legato.v1", schemaVersion: 1, clips: [], tags: [], queue: [] };
}

/** The pinned clock (deterministic ISO timestamps — no `new Date`). */
const NOW = "2026-11-07T00:00:00.000Z";
const clock = () => NOW;

async function clipWith(
  canned: ConstructorParameters<typeof FakeFetcher>[1],
  url = "http://x.test/page",
  data: LegatoData = emptyData(),
) {
  const fetcher = new FakeFetcher(url, canned);
  return clipUrl(url, { fetcher, data, clock });
}

/** Structural shape pins shared by every Clip record (the grammar). */
function assertBaseShape(c: Clip, url: string) {
  expect(c.id).toBe(1); // empty store -> nextId = 1
  expect(c.url).toBe(url);
  expect(c.state).toBe("unread");
  expect(c.tags).toEqual([]);
  expect(c.highlights).toEqual([]);
  expect(c.createdAt).toBe(NOW);
  expect(c.updatedAt).toBe(NOW);
  // a full Clip record must pass the domain invariants (the grammar gate)
  const data: LegatoData = {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [c],
    tags: [],
    queue: [c.id],
  };
  assertData(data);
}

// ---- lanes that short-circuit BEFORE extraction (DOM-free in
// both lanes — no parser is ever reached) ----

test("T-1: charset-unknown -> error clip, empty text, never mojibake", async () => {
  const c = await clipWith(FakeFetcher.charsetUnknown(), "http://cs.test/foreign");
  assertBaseShape(c, "http://cs.test/foreign");
  expect(c.error).toBe("charset-unknown");
  expect(c.text).toBe("");
});

test("T-2: redirect-loop -> error clip (the canned cycle chain)", async () => {
  // The canned chain's terminal hop re-enters the ORIGIN URL, which
  // the test's requested URL must match VERBATIM (the seen-set is
  // exact-string: "http://loop.test" and "http://loop.test/" are
  // different keys).
  const c = await clipWith(FakeFetcher.redirectLoop("http://loop.test"), "http://loop.test");
  assertBaseShape(c, "http://loop.test");
  expect(c.error).toBe("redirect-loop");
  expect(c.text).toBe("");
});

test("T-3: 403 wall -> js-walled clip (title+URL+flag, the fallback lane)", async () => {
  const c = await clipWith(FakeFetcher.walled403(), "http://wall.test/403");
  assertBaseShape(c, "http://wall.test/403");
  expect(c.error).toBe("js-walled");
  expect(c.jsWalled).toBe(true);
  expect(c.text).toBe("");
  expect(c.title.length).toBeGreaterThan(0);
});

test("T-3: 429 wall -> js-walled clip (same lane)", async () => {
  const c = await clipWith(FakeFetcher.walled429(), "http://wall.test/429");
  assertBaseShape(c, "http://wall.test/429");
  expect(c.error).toBe("js-walled");
  expect(c.jsWalled).toBe(true);
});

test("T-7: network reject -> fetch-failed clip (never a silent hang)", async () => {
  const c = await clipWith(FakeFetcher.networkReject(), "http://gone.test/page");
  assertBaseShape(c, "http://gone.test/page");
  expect(c.error).toBe("fetch-failed");
  expect(c.text).toBe("");
});

test("id allocation: a seeded store allocates against its max (ids.ts)", async () => {
  const seeded: LegatoData = {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [
      {
        id: 7,
        url: "http://seed.test",
        title: "Seed",
        text: "seed body",
        tags: [],
        state: "done",
        highlights: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    tags: [],
    queue: [7],
  };
  const fetcher = new FakeFetcher("http://new.test", FakeFetcher.clean());
  const clip = await clipUrl("http://new.test", { fetcher, data: seeded, clock });
  expect(clip.id).toBe(8);
});

// ---- lanes that REACH the extractor (DOM-guarded: the default
// parser is the DOMParser runtime lookup — Lane B only) ----

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip(
    "orchestrator extraction lanes (clean/paywalled/oversized/empty) — requires a DOM (Lane B's happy-dom provides it)",
    () => {},
  );
} else {
  test("clean: the happy path — full readable body, no error", async () => {
    const c = await clipWith(FakeFetcher.clean(), "http://clean.test/story");
    assertBaseShape(c, "http://clean.test/story");
    expect(c.error).toBeUndefined();
    expect(c.title).toBe("Clean");
    expect(c.text.length).toBeGreaterThan(30);
    expect(c.jsWalled).toBeUndefined();
    expect(c.emptyText).toBeUndefined();
  });

  test("T-3: empty-but-200 JS shell -> js-walled clip (the qa-architect form)", async () => {
    const c = await clipWith(FakeFetcher.emptyBut200(), "http://shell.test/app");
    assertBaseShape(c, "http://shell.test/app");
    expect(c.error).toBe("js-walled");
    expect(c.jsWalled).toBe(true);
  });

  test("T-4: paywalled -> excerpt + paywallExcerptOnly flag, never bypass", async () => {
    const c = await clipWith(FakeFetcher.paywalled(), "http://paid.test/story");
    assertBaseShape(c, "http://paid.test/story");
    expect(c.error).toBe("paywalled");
    expect(c.paywallExcerptOnly).toBe(true);
    expect(c.excerpt).toBeDefined();
    expect(c.text.length).toBeGreaterThan(0);
  });

  test("T-5: oversized -> 500 KB cap, retained prefix + flag", async () => {
    const c = await clipWith(FakeFetcher.oversized(600_000), "http://huge.test/giant");
    assertBaseShape(c, "http://huge.test/giant");
    expect(c.error).toBe("oversized");
    // the retained prefix: exactly the 500 KB cap
    expect(c.text.length).toBe(500 * 1024);
  });

  test("T-6: empty-article -> empty-text clip (title+URL fallback + flag)", async () => {
    const c = await clipWith(FakeFetcher.emptyArticle(), "http://empty.test/void");
    assertBaseShape(c, "http://empty.test/void");
    expect(c.error).toBe("empty-text");
    expect(c.emptyText).toBe(true);
    expect(c.text).toBe("");
    expect(c.title).toBe("Empty"); // the document title survives
  });
}
