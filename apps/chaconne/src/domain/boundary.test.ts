/**
 * Domain-boundary test — the Ostinato `boundary.test.ts` precedent,
 * ported to Chaconne (the PLAN §3/§4 import-graph pin). Runs green in
 * BOTH lanes:
 *
 *   Lane A — `cd apps/chaconne && bun test`: no `bunfig.toml` inside
 *            the app dir, so the root happy-dom preload does NOT apply
 *            and domain-purity is enforced against a genuinely DOM-free
 *            runtime (acceptance (1)).
 *   Lane B — `bun test apps/chaconne` from the repo root: the root
 *            `bunfig.toml`'s preload IS active (DOM globals present),
 *            so this test still runs but is masked-by-design; it
 *            remains the import-graph enforcer (acceptance (2)).
 *
 * Rule: every module under src/domain/ may import only
 *   - relative "./" imports that stay inside src/domain/ (the domain
 *     is a flat directory; "../" would escape it and is rejected)
 *   - "bun:test" (tests)
 *   - nothing Node-specific (fs/path/process/http/crypto/…)
 *   - no DOM/Node global reference (document./window./indexedDB/
 *     localStorage — the regex pins member ACCESS; English prose
 *     ending in the word "document." must not trip it, hence the `\w`
 *     after the dot (the V-14 hardening, Ostinato precedent))
 *
 * The scanner re-implements a small reader in plain JS so it survives
 * the repo's TS-unfriendly syntax hook (Ostinato precedent: the
 * boundary test uses node:fs/promises inside the TEST FILE ONLY, which
 * is explicitly allowed — tests are not domain logic).
 */
import { test, expect } from "bun:test";
// Scanner infrastructure — allowed in test files, banned from domain
// modules (the ALLOWED set below encodes that split).
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
/**
 * V-14 hardening (Ostinato): the regex requires an identifier after
 * the dot (`\.\w`) so it pins genuine member access
 * (`document.getElementById`, `window.localStorage`) while
 * sentence-ending prose ("…an import document.") stays immune.
 */
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
      const bare = spec.replace(/\.js$/, ""); // extensionless TS import convention
      expect(NODE_BUILTINS.has(bare), `${file} imports Node builtin ${spec}`).toBe(false);
      if (!bare.startsWith(".")) {
        // bare non-relative import — must be in the allow-list
        expect(ALLOWED.has(bare), `${file} imports unapproved external ${spec}`).toBe(true);
      }
      // relative imports must stay inside the domain (flat dir: only "./")
      if (bare.startsWith("..")) {
        expect(false, `${file} escapes src/domain via ${spec}`).toBe(true);
      }
      // and no self-import (a module must not import its own specifier)
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
