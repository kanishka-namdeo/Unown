/**
 * Domain-boundary test — the Ostinato/Chaconne `boundary.test.ts`
 * precedent, ported to Fugue (PLAN §1/§6 import-graph pin). Runs green
 * in BOTH lanes:
 *
 *   Lane A — `cd apps/fugue && bun test`: no `bunfig.toml` inside the
 *            app dir, so the root happy-dom preload does NOT apply and
 *            domain-purity is enforced against a genuinely DOM-free
 *            runtime.
 *   Lane B — `bun test apps/fugue` from the repo root: the root
 *            `bunfig.toml`'s preload IS active (DOM globals present),
 *            so this test is masked-by-design; it remains the
 *            import-graph enforcer.
 *
 * Rule: every module under src/domain/ may import only
 *   - relative "./" imports that stay inside src/domain/ (the domain
 *     is a flat directory; "../" would escape it and is rejected)
 *   - "bun:test" (tests)
 *   - nothing Node-specific (fs/path/process/http/crypto/…)
 *   - no DOM/Node global reference (the regex pins member ACCESS:
 *     `document.x` / `window.x` / …; the `\w` after the dot keeps
 *     sentence-ending prose immune — the Ostinato V-14 hardening)
 *
 * The scanner uses node:fs/promises inside the TEST FILE ONLY —
 * tests are not domain logic (the Ostinato/Chaconne precedent).
 */
import { test, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const DOMAIN_DIR = import.meta.dir;

const ALLOWED = new Set(["bun:test"]);
const NODE_BUILTINS = new Set([
  "node:fs", "fs", "node:fs/promises", "node:path", "path",
  "node:process", "process", "node:os", "os",
  "node:http", "http", "node:crypto", "crypto", "node:buffer",
  "node:stream", "stream", "node:net", "net", "node:url", "url",
  "node:util", "util",
]);
/** The V-14 hardening: requires an identifier after the dot, so genuine
 * member access (`document.getElementById`) is pinned while prose is
 * immune. */
const DOM_GLOBS = /\b(document|window|indexedDB|localStorage|sessionStorage)\.\w/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("domain modules: no Node builtins, no DOM globals, closed import graph", async () => {
  const files = await walk(DOMAIN_DIR);
  const testFiles = files.filter((f) => f.endsWith(".test.ts"));
  const domainFiles = files.filter((f) => !f.endsWith(".test.ts"));

  expect(domainFiles.length).toBeGreaterThan(0); // the domain is not empty

  for (const file of domainFiles) {
    const src = await readFile(file, "utf8");

    // 1. No DOM/Node global use.
    expect(DOM_GLOBS.test(src), `${file} references a DOM/Node global`).toBe(false);

    // 2. Import scan.
    const importRe = /import\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      const bare = spec.replace(/\.js$/, "");
      expect(NODE_BUILTINS.has(bare), `${file} imports Node builtin ${spec}`).toBe(false);
      if (!bare.startsWith(".")) {
        expect(ALLOWED.has(bare), `${file} imports unapproved external ${spec}`).toBe(true);
      }
      // relative imports must stay inside the domain (flat dir: only "./")
      if (bare.startsWith("..")) {
        expect(false, `${file} escapes src/domain via ${spec}`).toBe(true);
      }
      // and no self-import
      const ownName = file.slice(DOMAIN_DIR.length + 1).replace(/\.ts$/, "");
      if (bare === ownName || bare === `./${ownName}`) {
        expect(false, `${file} self-imports ${spec}`).toBe(true);
      }
    }
  }

  // 3. Test files MAY use node:fs (scanner infra) — verify the test
  //    set is what we expect, nothing hidden.
  expect(testFiles.length).toBeGreaterThanOrEqual(1);
});
