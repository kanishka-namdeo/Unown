/**
 * boundary-adapter.test.ts — the F-2 boundary pin EXTENDED to the
 * adapter seam (PLAN §3 F-2; mirrors the domain's `boundary.test.ts`).
 *
 * Rule (the brief's law): every module under `src/adapter/` imports
 * ONLY from `src/domain/` (relative `../domain/*` or `./` inside the
 * adapter dir). No engine imports, no `fetch`, no Node builtins, no
 * DOM globals — the real HTTP adapter is F-3's runner-side concern,
 * not this layer's. The scanner (node:fs/promises) runs in the TEST
 * file only, same as the domain boundary test.
 */
import { test, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const ADAPTER_DIR = import.meta.dir;

const ALLOWED_BARE = new Set(["bun:test"]);
const NODE_BUILTINS = new Set([
  "node:fs", "fs", "node:fs/promises", "node:path", "path",
  "node:process", "process", "node:os", "os",
  "node:http", "http", "node:crypto", "crypto", "node:buffer",
  "node:stream", "stream", "node:net", "net", "node:url", "url",
  "node:util", "util",
]);
const DOM_GLOBS = /\b(document|window|indexedDB|localStorage|sessionStorage)\.\w/;
/** The network-free law: no fetch / XMLHttpRequest / AbortController
 *  in the seam (the real transport is F-3's runner edge). */
const NETWORK_GLOBS = /\bfetch\s*\(|\bXMLHttpRequest\b|\bAbortController\b|\bWebSocket\b/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("adapter modules: import ONLY from src/domain, no network, no Node builtins", async () => {
  const files = await walk(ADAPTER_DIR);
  const testFiles = files.filter((f) => f.endsWith(".test.ts"));
  // The H-24 generated recording (2026-11-07) is DATA, not code: a
  // verbatim live-wire capture whose PROSE legitimately contains words
  // the DOM/network regexes pin in code (a dream output mentioning
  // "localStorage." / "window.chrome"; a memory note naming "fetch(").
  // The file has ZERO imports and never executes — the scanner's
  // purpose is pinning code, and a no-import data module cannot touch
  // the DOM. Enumerated by exact filename (the L-1/L-2 exemption
  // precedent: named + commented, never a pattern match); the sibling
  // fixtures-live.test.ts still scans as a test file.
  const GENERATED_DATA = new Set(["fixtures-live.gen.ts"]);
  const adapterFiles = files.filter(
    (f) => !f.endsWith(".test.ts") && !GENERATED_DATA.has(f.split("/").pop() ?? ""),
  );

  expect(adapterFiles.length).toBeGreaterThan(0); // the seam is not empty

  for (const file of adapterFiles) {
    const src = await readFile(file, "utf8");

    // 1. No DOM global reference (the V-14 `\w`-after-dot rule).
    expect(DOM_GLOBS.test(src), `${file} references a DOM global`).toBe(false);

    // 2. The network-free law (the browser closure carries no transport).
    expect(NETWORK_GLOBS.test(src), `${file} uses a network global (fetch/XHR/…)`).toBe(false);

    // 3. Import scan: only `./` (inside the adapter), `../domain/*`
    //    (the F-1 vocabulary), or `bun:test` — never an engine import,
    //    never a Node builtin, and never an upward `../` escape.
    const importRe = /import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      const bare = spec.replace(/\.js$/, "");
      if (NODE_BUILTINS.has(bare)) {
        expect(false, `${file} imports Node builtin ${spec}`).toBe(true);
      }
      if (bare.startsWith("./")) continue; // inside the adapter dir
      if (bare.startsWith("../domain/")) continue; // the F-1 vocabulary
      if (bare === "bun:test") continue;
      // Anything else is an escape: an engine import, a node builtin
      // spelled bare, or an upward relative that leaves the app.
      expect(false, `${file} imports unapproved external ${spec}`).toBe(true);
    }
  }

  // 4. The test set is what we expect (nothing hidden).
  expect(testFiles.length).toBeGreaterThanOrEqual(2); // contract + engine + boundary
});
