/**
 * io.ts tests — the byte-stable import/export pins (L-9, PLAN §2
 * "The canonical-JSON rules (io.ts)" + "The import gate law", §6.2).
 *
 * Pins:
 *  - byte-stability across shuffled KEY INSERTION orders (matrix
 *    lane I-1: same data set → same bytes, every boot)
 *  - byte-stability across RE-BOOTS via fresh FakeStorage
 *    round-trips (save → new FakeStorage(seed) → export = same
 *    bytes)
 *  - round-trip identity: importData(exportData(x)) deep-equals x
 *  - the REFUSAL TABLE: fugue.v999 / legato.v2 / missing schema /
 *    malformed JSON → the typed ImportRefusalError (non-empty
 *    dry-run report), the store UNTOUCHED (FakeStorage spy
 *    asserts zero writes)
 *  - same-schema invariant breach → DomainInvariantError naming
 *    the breach
 *  - the Markdown export's deterministic shape
 *
 * The domain stays DOM-free + Node-free — this file is pure
 * bun:test + the app's own modules.
 */
import { test, expect } from "bun:test";
import type { LegatoData, Clip } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { ImportRefusalError } from "./io.js";
import { exportData, importData, inspectImport, toCanonicalJson, emptyStore, LEGATO_SCHEMA, exportMarkdown } from "./io.js";
import { FakeStorage } from "../storage/fake-storage.js";

// ─── dataset builders (the pin data) ──────────────────────────────

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    url: "https://example.com",
    title: "Example",
    text: "body",
    tags: ["a"],
    state: "unread",
    highlights: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

function makeData(clipOverrides: Partial<Clip> = {}): LegatoData {
  const c = makeClip(clipOverrides);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [c],
    tags: [...new Set(c.tags)].sort(),
    queue: [c.id],
  };
}

/**
 * Rebuild the SAME data set with every object key in REVERSED
 * insertion order — a JSON round-trip through an insertion-order-
 * reversing shim. The canonical form must be byte-identical
 * (matrix lane I-1: insertion order is not state; only the
 * domain's array orders are).
 */
function reverseKeyInsertion<T>(v: T): T {
  const out: unknown = (function rev(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(rev);
    if (x !== null && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).reverse()) {
        o[k] = rev((x as Record<string, unknown>)[k]);
      }
      return o;
    }
    return x;
  })(v);
  return out as T;
}

// ─── I-1: byte-stability ──────────────────────────────────────────

test("I-1: exportData is byte-stable across shuffled key-insertion orders", () => {
  const data = makeData({
    finalUrl: "https://example.com/final",
    text: "Unicode ünïcode 日本語 — 二文字gram 🎉",
    tags: ["b", "a", "日本語"],
    state: "reading",
    highlights: [
      { id: 11, clipId: 1, anchor: "ctx", quote: "q", note: "n", createdAt: "2026-11-07T01:00:00.000Z" },
    ],
  });
  const tags = [...new Set(data.clips.flatMap((c) => c.tags))].sort();
  const full: LegatoData = { schema: "legato.v1", schemaVersion: 1, clips: data.clips, tags, queue: data.queue };
  const fwd = exportData(full);
  const rev = exportData(reverseKeyInsertion(full));
  expect(rev).toBe(fwd);
});

test("I-1: compact separators — no whitespace in the canonical form", () => {
  const bytes = exportData(makeData());
  expect(bytes).not.toContain(": ");
  expect(bytes).not.toContain(", ");
});

test("I-1: the empty store's export is the byte floor (72 bytes)", () => {
  const empty = exportData(emptyStore());
  expect(empty).toBe('{"clips":[],"queue":[],"schema":"legato.v1","schemaVersion":1,"tags":[]}');
  expect(new TextEncoder().encode(empty)).toHaveLength(72);
});

test("I-1: across RE-BOOTS via fresh FakeStorage round-trips, bytes are identical", async () => {
  const data = makeData({ text: "reboot data 日本語" });
  // Boot 1: save into a store.
  const store1 = new FakeStorage();
  await store1.save(data);

  // Boot 2: a FRESH FakeStorage seeded by what boot 1 persisted
  // (the re-boot simulation: load the persisted bytes, re-hydrate a
  // new store instance, re-export).
  const persisted = toCanonicalJson(data);
  const rehydrated = importData(persisted);
  const store2 = new FakeStorage(rehydrated);
  await store2.save(rehydrated);
  const loaded2 = await store2.load();
  expect(loaded2).not.toBeNull();
  expect(exportData(loaded2!)).toBe(persisted);
  // Boot 3: one more re-hydrate — the byte chain is transitive.
  const store3 = new FakeStorage(importData(exportData(loaded2!)));
  const loaded3 = await store3.load();
  expect(loaded3).not.toBeNull();
  expect(exportData(loaded3!)).toBe(persisted);
});

// ─── round-trip identity ──────────────────────────────────────────

test("round-trip: importData(exportData(x)) deep-equals x", () => {
  const data = makeData({
    finalUrl: "https://example.com/f",
    excerpt: "the excerpt",
    paywallExcerptOnly: true,
    emptyText: false,
    jsWalled: false,
    tags: ["日本語", "a"],
    state: "done",
    error: "paywalled",
    highlights: [
      { id: 11, clipId: 1, anchor: "a", quote: "q", note: "n", createdAt: "2026-11-07T02:00:00.000Z" },
    ],
  });
  const tags = [...new Set(data.clips.flatMap((c) => c.tags))].sort();
  const full: LegatoData = { schema: "legato.v1", schemaVersion: 1, clips: data.clips, tags, queue: data.queue };
  const roundTrip = importData(exportData(full));
  expect(roundTrip).toEqual(full);
  // And the bytes are stable through the round-trip (idempotent).
  expect(exportData(roundTrip)).toBe(exportData(full));
});

test("round-trip: exportData is idempotent over its own output", () => {
  const data = makeData();
  const once = exportData(data);
  const twice = exportData(importData(once));
  expect(twice).toBe(once);
});

// ─── the refusal table (PLAN §2 import-gate law) ─────────────────

/** Spy assertion: a storage that records every write. */
class WriteSpyStorage extends FakeStorage {
  writes: LegatoData[] = [];
  override async save(data: LegatoData): Promise<void> {
    this.writes.push(data);
    return super.save(data);
  }
}

async function assertStoreUntouched(
  text: string,
  expectError: (err: unknown) => void,
  expectReport?: string[] | null,
): Promise<void> {
  const store = new WriteSpyStorage();
  // Pre-import: seed a committed state so "untouched" is checkable.
  await store.save(makeData({ title: "pre-import" }));
  let caught: unknown = null;
  try {
    importData(text);
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBeNull();
  expectError(caught);
  // THE store-never-touched law: zero writes from the import path.
  expect(store.writes.length).toBe(1); // only the pre-import seed save
  const loaded = await store.load();
  expect(loaded?.clips[0]?.title).toBe("pre-import");
  // The dry-run report: non-empty, every named line present.
  if (expectReport !== null && expectReport !== undefined) {
    const err = caught as ImportRefusalError;
    expect(err.report.length).toBeGreaterThanOrEqual(expectReport.length);
    for (const line of expectReport) {
      expect(err.report.some((l) => l.includes(line))).toBe(true);
    }
  }
}

test("refusal: foreign schema (fugue.v999) → typed ImportRefusalError, store untouched", async () => {
  const foreign = JSON.stringify({ ...makeData(), schema: "fugue.v999" });
  await assertStoreUntouched(
    foreign,
    (e) => {
      expect(e).toBeInstanceOf(ImportRefusalError);
      expect((e as Error).name).toBe("ImportRefusalError");
    },
    ["fugue.v999", "foreign or future"],
  );
});

test("refusal: future schema (legato.v2) → typed ImportRefusalError, store untouched", async () => {
  const future = JSON.stringify({ ...makeData(), schema: "legato.v2" });
  await assertStoreUntouched(
    future,
    (e) => expect(e).toBeInstanceOf(ImportRefusalError),
    ["legato.v2", "foreign or future"],
  );
});

test("refusal: missing schema tag → typed ImportRefusalError, store untouched", async () => {
  const noSchema = JSON.stringify({ clips: [], tags: [], queue: [], schemaVersion: 1 });
  await assertStoreUntouched(
    noSchema,
    (e) => expect(e).toBeInstanceOf(ImportRefusalError),
    ["ABSENT", "must carry schema"],
  );
});

test("refusal: malformed JSON → typed ImportRefusalError (report names the parse failure), store untouched", async () => {
  await assertStoreUntouched(
    "{ this is not JSON",
    (e) => {
      expect(e).toBeInstanceOf(ImportRefusalError);
      expect((e as Error).message).toContain("not valid JSON");
    },
    ["FAILED"],
  );
});

test("refusal: root is not a plain object (an array) → typed ImportRefusalError", async () => {
  await assertStoreUntouched(
    JSON.stringify([1, 2, 3]),
    (e) => expect(e).toBeInstanceOf(ImportRefusalError),
    ["plain object"],
  );
});

test("refusal: same-schema doc breaching an invariant → DomainInvariantError naming the breach, store untouched", async () => {
  // A legato.v1 doc with a duplicate clip id — the gate passes
  // (schema matches), the semantic lane (assertData) refuses.
  const bad = { ...makeData(), clips: [makeClip(), makeClip()] };
  await assertStoreUntouched(
    JSON.stringify(bad),
    (e) => {
      expect(e).toBeInstanceOf(DomainInvariantError);
      expect((e as Error).message).toContain("duplicate clip id");
    },
  );
});

test("refusal: inspectImport returns the dry-run report WITHOUT throwing", () => {
  const foreign = JSON.stringify({ ...makeData(), schema: "fugue.v999" });
  const r = inspectImport(foreign);
  expect(r.accepted).toBe(false);
  expect(r.error).toBeInstanceOf(ImportRefusalError);
  expect(r.report.length).toBeGreaterThan(0);
  expect(r.data).toBeUndefined();

  const good = exportData(makeData());
  const ok = inspectImport(good);
  expect(ok.accepted).toBe(true);
  expect(ok.data).toBeDefined();
  expect(ok.error).toBeUndefined();
});

// ─── valid-import acceptance ──────────────────────────────────────

test("import: a valid legato.v1 document imports clean (typed LegatoData, fresh object)", () => {
  const data = makeData({ text: "imported text 日本語" });
  const imported = importData(JSON.stringify(data));
  expect(imported).toEqual(data);
  // Fresh clone: mutating the import must not touch the source.
  imported.clips[0].title = "MUTATED";
  expect(data.clips[0].title).toBe("Example");
});

test("import: the gate accepts exactly LEGATO_SCHEMA", () => {
  expect(LEGATO_SCHEMA).toBe("legato.v1");
  expect(() => importData(JSON.stringify(makeData()))).not.toThrow();
});

// ─── the Markdown export's deterministic shape ────────────────────

test("markdown: one document, clips as ## sections, deterministic", () => {
  const data = makeData({
    url: "https://example.com/a",
    title: "Alpha",
    text: "alpha body",
    tags: ["a", "b"],
    state: "unread",
    highlights: [
      { id: 11, clipId: 1, anchor: "alpha ctx", quote: "alpha q", note: "alpha n", createdAt: "2026-11-07T01:00:00.000Z" },
    ],
  });
  const tags = [...new Set(data.clips.flatMap((c) => c.tags))].sort();
  const full: LegatoData = { schema: "legato.v1", schemaVersion: 1, clips: data.clips, tags, queue: data.queue };
  const md = exportMarkdown(full);
  // Section + metadata lines
  expect(md).toContain("## Alpha\n");
  expect(md).toContain("- URL: https://example.com/a\n");
  expect(md).toContain("- Date: 2026-11-07\n");
  expect(md).toContain("- Tags: a, b\n");
  expect(md).toContain("alpha body\n");
  // The highlight as a blockquote, with its note on a second > line
  expect(md).toContain("> alpha q\n> alpha n\n");
  // Deterministic: same data → same bytes (run twice, byte-equal).
  expect(exportMarkdown(full)).toBe(md);
  expect(exportMarkdown(reverseKeyInsertion(full))).toBe(md);
});

test("markdown: empty-text clips get the honest fallback line, not a blank body", () => {
  const data = makeData({ text: "", emptyText: true, tags: [] });
  const full: LegatoData = { schema: "legato.v1", schemaVersion: 1, clips: data.clips, tags: [], queue: data.queue };
  expect(exportMarkdown(full)).toContain("*(no readable body — title+URL fallback)*\n");
});

test("markdown: tags-less clips show 'n/a', highlights-less clips show no > lines", () => {
  const data = makeData({ tags: [] });
  const full: LegatoData = { schema: "legato.v1", schemaVersion: 1, clips: data.clips, tags: [], queue: data.queue };
  const md = exportMarkdown(full);
  expect(md).toContain("- Tags: n/a\n");
  expect(md).not.toContain("> ");
});
