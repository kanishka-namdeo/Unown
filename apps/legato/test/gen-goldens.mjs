import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const { exportData, emptyStore } = await import(join(srcDir, "domain", "io.ts"));
const { migrate } = await import(join(srcDir, "storage", "migration.ts"));

mkdirSync(join(here, "goldens"), { recursive: true });

// Golden 1: the empty store (the byte floor of the canonical form).
const empty = emptyStore();
writeFileSync(join(here, "goldens", "empty.json"), exportData(empty), "utf8");

// Golden 2: the populated store — unicode + CJK + highlights + every ClipState.
function makeClip(overrides = {}) {
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
const c1 = makeClip({
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
});
const c2 = makeClip({
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
});
const c3 = makeClip({
  id: 3,
  url: "https://legato.example/reading/done",
  title: "Third clip — done",
  text: "Short finished body.",
  tags: [],
  state: "done",
  highlights: [],
  createdAt: "2026-11-07T04:00:00.000Z",
  updatedAt: "2026-11-07T05:00:00.000Z",
});
const c4 = makeClip({
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
});
const populated = {
  schema: "legato.v1",
  schemaVersion: 1,
  clips: [c1, c2, c3, c4],
  tags: ["reading", "日本語", "test", "unicode", "読書"],
  queue: [1, 2, 3, 4],
};
writeFileSync(join(here, "goldens", "populated.json"), exportData(populated), "utf8");

// Golden 3: the migrated-v1 store — the L-2 migration no-op pass applied FIRST.
const migrated = migrate(populated, 1);
writeFileSync(join(here, "goldens", "migrated-v1.json"), exportData(migrated), "utf8");

for (const n of ["empty.json", "populated.json", "migrated-v1.json"]) {
  const bytes = readFileSync(join(here, "goldens", n));
  console.log(n, bytes.length, "bytes");
}
