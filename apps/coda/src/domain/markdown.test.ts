/**
 * Markdown round-trip — ticket C1 edge cases.
 *
 * Property: for EVERY note in the edge-case matrix below,
 * `markdownToNote(noteToMarkdown(n))` deep-equals `n` (all fields,
 * including timestamps and tags).
 */
import { test, expect } from "bun:test";
import { noteToMarkdown, markdownToNote, MarkdownParseError } from "./markdown";
import type { Note } from "./types";

const T = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function note(over: Partial<Note>): Note {
  return {
    id: "n1",
    title: "default",
    body: "",
    createdAt: T,
    updatedAt: T2,
    tags: [],
    ...over,
  };
}

function assertRoundTrips(n: Note): void {
  const md = noteToMarkdown(n);
  const back = markdownToNote(md);
  expect(back.id).toBe(n.id);
  expect(back.title).toBe(n.title);
  expect(back.body).toBe(n.body);
  expect(back.createdAt).toBe(n.createdAt);
  expect(back.updatedAt).toBe(n.updatedAt);
  expect(back.tags).toEqual(n.tags);
}

const edgeCases: Array<{ label: string; n: Note }> = [
  { label: "normal", n: note({ title: "My Note", body: "line one\nline two", tags: ["a", "b"] }) },
  { label: "empty title", n: note({ title: "", body: "just body" }) },
  { label: "empty body", n: note({ title: "T", body: "" }) },
  { label: "both empty + no tags", n: note({ title: "", body: "", tags: [] }) },
  { label: "body starting with '# '", n: note({ title: "", body: "# looks like a title but is body" }) },
  { label: "body with '# ' and title set", n: note({ title: "X", body: "# also looks like heading" }) },
  { label: "body containing '---' lines", n: note({ title: "hr", body: "top\n---\nmid\n---\nbottom" }) },
  { label: "body that IS only '---'", n: note({ title: "T", body: "---" }) },
  { label: "unicode", n: note({ title: "标题", body: "日本語 · ☃ — 📝", tags: ["naïve", "émoji 🎉"] }) },
  { label: "body with code fences + --- inside fence", n: note({ title: "code", body: "```\n---\n# inside\n```" }) },
  { label: "body starting with blank lines", n: note({ title: "B", body: "\n\nstart" }) },
  { label: "tags with JSON-special chars", n: note({ title: "T", tags: ['has "quote"', "br[acket]", "back\\slash"] }) },
];

for (const { label, n } of edgeCases) {
  test(`round-trip: ${label}`, () => assertRoundTrips(n));
}

test("noteToMarkdown emits the always-present '# ' title line", () => {
  const md = noteToMarkdown(note({ title: "" }));
  // the line after the closing --- must be exactly "# " (empty title)
  const lines = md.split("\n");
  const closeIdx = lines.slice(1).findIndex((l) => l === "---") + 1;
  expect(lines[closeIdx + 1]).toBe("# ");
});

test("markdownToNote rejects a document without a header", () => {
  expect(() => markdownToNote("# just markdown\nno header")).toThrow(MarkdownParseError);
});

test("markdownToNote rejects a missing closing delimiter", () => {
  expect(() => markdownToNote("---\nid: x\n")).toThrow(MarkdownParseError);
});
