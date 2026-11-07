/**
 * goldens — the 3 export goldens pinned byte-for-byte (L-9, PLAN
 * §6.2 "The 3 export goldens"). The goldens are PINNED, not
 * re-derived (the Chaconne §5 edge-9 law): the test recomputes
 * the canonical bytes and asserts byte-equality against the
 * committed files under `test/goldens/`. Regenerating a golden is
 * a deliberate re-freeze (delete + re-run `test/gen-goldens.mjs`),
 * never implicit.
 *
 * These tests are NOT unit tests — they read files from disk via
 * `node:fs`, which is allowed in `.test.ts` (the Ostinato/Chaconne
 * boundary-test precedent: scanner infrastructure in test files
 * only). The source data is reconstructed inline (a pure JSON
 * literal, not a re-import of the generator) so the pin is
 * self-contained and the golden is the ONLY external truth.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LegatoData, Clip } from "../src/domain/types.js";
import { exportData, importData, emptyStore } from "../src/domain/io.js";
import { migrate } from "../src/storage/migration.js";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "goldens");

function golden(name: string): string {
  return readFileSync(join(GOLDENS_DIR, name), "utf8");
}

// ─── the source data (inline, pure literals) ─────────────────────
// Reconstructed to match test/gen-goldens.mjs exactly. These are the
// three "source datasets" whose export bytes the goldens pin.

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

// Golden 1: the empty store (the byte floor of the canonical form).
const EMPTY: LegatoData = emptyStore();

// Golden 2: the populated store — unicode + CJK + highlights +
// every ClipState (the §6.2 UTF-8 byte-stability pin).
const POPULATED: LegatoData = {
  schema: "legato.v1",
  schemaVersion: 1,
  clips: [
    makeClip({
      id: 1,
      url: "https://legato.example/articles/well-known-things",
      finalUrl: "https://legato.example/articles/well-known-things?ref=rss",
      title: "Ünïcode title — café, naïve & 日本語",
      text: "Readable body with émojis 🎉 and CJK text 日本語の要約です. The well-known trick: 日本語のトークンは文字の二文字グラム (char-bigrams) と語 (words) のハイブリッド。",
      tags: ["読書", "日本語", "test", "unicode"],
      state: "unread",
      highlights: [
        { id: 11, clipId: 1, anchor: "context before the 日本語 quote", quote: "日本語の要約です", note: "the CJK bigram lane", createdAt: "2026-11-07T01:00:00.000Z" },
      ],
      createdAt: "2026-11-07T01:00:00.000Z",
      updatedAt: "2026-11-07T02:00:00.000Z",
    }),
    makeClip({
      id: 2,
      url: "https://legato.example/reading/second",
      title: "Second clip — reading",
      text: "Body of the second clip. — em-dash and curly “quotes” survive the UTF-8 byte lane.",
      tags: ["reading"],
      state: "reading",
      highlights: [
        { id: 12, clipId: 2, anchor: "em-dash context", quote: "— em-dash", createdAt: "2026-11-07T03:00:00.000Z" },
      ],
      createdAt: "2026-11-07T03:00:00.000Z",
      updatedAt: "2026-11-07T03:00:00.000Z",
    }),
    makeClip({
      id: 3,
      url: "https://legato.example/reading/done",
      title: "Third clip — done",
      text: "Short finished body.",
      tags: [],
      state: "done",
      highlights: [],
      createdAt: "2026-11-07T04:00:00.000Z",
      updatedAt: "2026-11-07T05:00:00.000Z",
    }),
    makeClip({
      id: 4,
      url: "https://legato.example/reading/archived",
      title: "Fourth clip — archived",
      text: "Archive body.",
      tags: [],
      state: "archived",
      highlights: [],
      createdAt: "2026-11-07T06:00:00.000Z",
      updatedAt: "2026-11-07T06:00:00.000Z",
      error: "js-walled",
    }),
  ],
  tags: ["reading", "日本語", "test", "unicode", "読書"],
  queue: [1, 2, 3, 4],
};

// Golden 3: the migrated-v1 store — the L-2 migration no-op pass
// applied FIRST (S-1's byte-level half, S-4's mid-migration export
// half). `migrate` is a structural no-op today, so its output is
// byte-identical to the populated export — the pin catches the
// moment a real v2 transform changes the bytes.
const MIGRATED: LegatoData = migrate(POPULATED, 1);

// ─── the drift gate: export bytes === committed golden bytes ────

test("golden 1 (empty store): export bytes equal the committed file", () => {
  expect(exportData(EMPTY)).toBe(golden("empty.json"));
});

test("golden 2 (populated store): export bytes equal the committed file", () => {
  expect(exportData(POPULATED)).toBe(golden("populated.json"));
});

test("golden 3 (migrated v1 store): export bytes equal the committed file", () => {
  expect(exportData(MIGRATED)).toBe(golden("migrated-v1.json"));
});

test("golden consistency: the golden files are canonical JSON (re-parse round-trip)", () => {
  // Each committed golden must be a valid LegatoData under
  // importData — the byte floor is the wire shape, not an opaque
  // blob.
  for (const name of ["empty.json", "populated.json", "migrated-v1.json"]) {
    const bytes = golden(name);
    // importData(golden bytes) must succeed (a self-import of the
    // app's own output is always admissible — the gate passes its
    // own exports).
    const doc = importData(bytes);
    expect(doc.schema).toBe("legato.v1");
    // And re-exporting is byte-stable (idempotent).
    expect(exportData(doc)).toBe(bytes);
  }
});
