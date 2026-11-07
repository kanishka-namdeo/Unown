/**
 * Import-graph pin (the L-1 boundary law, PLAN §1.1/§1.2, §5.3).
 *
 * Scans every `.ts` file under `src/` (recursive, via node:fs) and
 * asserts each import specifier is either a relative `./` / `../`
 * specifier or `bun:test` — that single file IS the network-free-
 * closure proof and the zero-dep law's executable form.
 *
 *   - every file under `src/**` may import only `./`/`../`/`bun:test`
 *   - nothing Node-specific (fs/path/process/http/crypto/…), no
 *     DOM/Node globals in the domain modules (`DOM_GLOBS`)
 *   - relative imports must stay inside their own directory or climb
 *     exactly one level up to a sibling layer (`../`) — `../../` or
 *     worse escapes the `src/**` closure and is rejected
 *
 * Test-file exemption (node: builtins): `node:fs`/`node:fs/promises`
 * scanner infrastructure is allowed in `.test.ts` files only (the
 * Ostinato/Chaconne boundary-test precedent), never in non-test
 * modules.
 *
 * Both lanes:
 *   Lane A — `cd apps/legato && bun test`: no `bunfig.toml` inside
 *            the app dir, so the root happy-dom preload does NOT
 *            apply; the DOM-free runtime IS the enforcement lane.
 *   Lane B — `bun test apps/legato` from the repo root: the root
 *            `bunfig.toml`'s preload IS active (DOM globals present)
 *            so this test still runs but is masked-by-design; it
 *            remains the import-graph enforcer.
 */
import { test, expect } from "bun:test";
// Scanner infrastructure — allowed in test files, banned from
// non-test modules (the NODE_BUILTINS set below encodes that split).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dir, "..");

const ALLOWED = new Set(["bun:test"]);
const NODE_BUILTINS = new Set([
  "node:fs", "fs", "node:fs/promises", "node:path", "path",
  "node:process", "process", "node:os", "os",
  "node:http", "http", "node:https", "https", "node:crypto",
  "crypto", "node:buffer", "node:stream", "stream", "node:net",
  "net", "node:url", "url", "node:util", "util", "node:child_process",
  "child_process", "node:worker_threads", "worker_threads",
]);
/**
 * Pins genuine member access (`document.getElementById`,
 * `window.localStorage`, `indexedDB.open`, `localStorage.setItem`)
 * while sentence-ending English prose ("…an import document.")
 * stays immune — hence the `\w` after the dot (the V-14 hardening,
 * Ostinato/Chaconne precedent).
 */
const DOM_GLOBS = /\b(document|window|indexedDB|localStorage|sessionStorage)\.\w/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Depth of a relative specifier: count the `../` segments + the
 *  `./` (or bare first segment). `../../x` is depth 3 (two ups). */
function upDepth(spec: string): number {
  let depth = 0;
  for (const seg of spec.split("/")) {
    if (seg === "..") depth += 1;
    else if (seg !== "." && seg !== "") break;
  }
  return depth;
}

test("src/**: closed import graph — every import is ./ / ../ or bun:test", async () => {
  const files = await walk(SRC_DIR);
  expect(files.length).toBeGreaterThan(0); // src/** is not empty

  for (const file of files) {
    const src = await readFile(file, "utf8");
    const isTest = file.endsWith(".test.ts");

    // 1. No DOM/Node globals — domain modules stay DOM-free
    //    (the Ostinato law); test files are exempt here only to
    //    keep this file itself honest (it uses node:fs).
    if (!isTest) {
      expect(DOM_GLOBS.test(src), `${file} references a DOM/Node global`).toBe(false);
    }

    // 2. Import scan — every specifier in every module under src/**.
    const importRe = /import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      const bare = spec.replace(/\.js$/, ""); // extensionless TS import convention

      if (ALLOWED.has(bare)) continue; // bun:test

      // 3. Node builtins: only test files may use scanner infra.
      if (NODE_BUILTINS.has(bare)) {
        if (isTest) continue;
        expect(false, `${file} (non-test) imports Node builtin ${spec}`).toBe(true);
        continue;
      }

      // 4. Must be a relative specifier — anything else is a
      //    network/package import the zero-dep law bans.
      expect(
        bare.startsWith("./") || bare.startsWith("../"),
        `${file} imports unapproved external ${spec}`,
      ).toBe(true);

      // 5. Up-depth bound: at most one `../` segment. Two ups
      //    (`../../`) would climb out of the app's src/** closure
      //    (the repo root or another app) — the zero-dep + PWA
      //    self-containment ruling (PLAN §1.2 devils-advocate).
      expect(
        upDepth(bare) <= 1,
        `${file} escapes the src/** closure via ${spec}`,
      ).toBe(true);
    }
  }
});
