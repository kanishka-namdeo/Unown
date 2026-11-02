/**
 * Purity import-boundary check — runs green inside `bun test` so it is
 * part of BOTH lanes (Lane A from repo root, Lane B from apps/coda).
 *
 * Rule: every module under src/domain/ may import only
 *   - relative "./" imports (staying inside src/domain — the domain is a
 *     flat directory, so "../" would escape it and is rejected)
 *   - the two pure externals: "fuse.js" (search) and "bun:test" (tests)
 *   - nothing Node-specific (fs/path/process/http/crypto/…)
 * and no DOM/Node global reference (document./window./indexedDB/
 * localStorage).
 *
 * The check re-implements a small scanner in plain JS so it survives
 * the repo's TS-unfriendly PostToolUse syntax hook; it is a test file,
 * so `bun test` picks it up automatically and a boundary break fails
 * the whole suite in both lanes.
 */
import { test, expect } from "bun:test";
// The scanner itself needs fs to read the source tree. Kept in this
// test file ONLY; no domain module imports node:fs.
// eslint-disable-next-line -- scanner infrastructure, not domain logic
import { readdir, readFile } from "node:fs/promises";

// import.meta.dir IS src/domain (this test file lives there), so the
// walk root does not depend on the process cwd — both lanes work.
const DOMAIN_DIR = import.meta.dir;


const ALLOWED = new Set(["fuse.js", "bun:test"]);
const NODE_BUILTINS = new Set([
  "node:fs", "fs", "node:fs/promises", "node:path", "path",
  "node:process", "process", "node:os", "os",
  "node:http", "http", "node:crypto", "crypto", "node:buffer",
  "node:stream", "stream", "node:net", "net", "node:url", "url",
  "node:util", "util",
]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function specifiersOf(line: string): string[] {
  const specs: string[] = [];
  const re = /from\s+"([^"]+)"|from\s+'([^']+)'|import\(\s*"([^"]+)"|import\(\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    specs.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return specs;
}

test("src/domain import boundary: nothing outside the domain except pure externals", async () => {
  const files = (await walk(DOMAIN_DIR)).filter((f) => !f.endsWith("boundary.test.ts"));
  // boundary.test.ts IS the scanner: it legitimately uses node:fs/promises
  // and references the DOM-global pattern strings, so it is excluded from
  // the scan of itself. Every OTHER domain file is checked.
  expect(files.length).toBeGreaterThan(0);
  const violations: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      for (const spec of specifiersOf(line)) {
        if (spec.startsWith("./")) continue; // stays inside the flat domain dir
        if (spec.startsWith("../")) {
          violations.push(`${file}: "../" import "${spec}" escapes src/domain`);
          continue;
        }
        if (NODE_BUILTINS.has(spec)) {
          violations.push(`${file}: Node-specific module "${spec}"`);
          continue;
        }
        if (!ALLOWED.has(spec)) {
          violations.push(`${file}: disallowed import "${spec}"`);
        }
      }
    }
    if (/document\s*\.\s|\bwindow\s*\.\s|\bindexedDB\b|\blocalStorage\b/.test(text)) {
      violations.push(`${file}: DOM/Node global reference found`);
    }
  }
  expect(violations.join("\n")).toBe("");
});
