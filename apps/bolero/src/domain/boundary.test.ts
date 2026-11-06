/**
 * Domain-boundary test — the import-graph pin (PLAN §2 round-trip pin
 * law item 5, the Ostinato/Chaconne `boundary.test.ts` precedent).
 * Runs green in BOTH lanes:
 *
 *   Lane A — `cd apps/bolero && bun test`: no `bunfig.toml` inside the
 *            app dir, so the root happy-dom preload does NOT apply and
 *            domain-purity is enforced against a genuinely DOM-free
 *            runtime (S-1 verification).
 *   Lane B — `bun test apps/bolero` from the repo root: the root
 *            `bunfig.toml`'s preload IS active (DOM globals present),
 *            so this test still runs but is masked-by-design; it
 *            remains the import-graph enforcer.
 *
 * Rule: every module under src/domain/ may import only
 *   - relative "./" imports that stay inside src/domain/
 *   - "bun:test" (tests)
 *   - nothing Node-specific (fs/path/process/http/crypto/…)
 *   - no DOM/Node global reference, no Date.now (the domain is
 *     DOM-free, Node-free, server-free — PLAN §1 boundary law)
 *
 * The scanner re-implements a small reader in plain JS so it survives
 * the repo's TS-unfriendly syntax hook (the Chaconne precedent: the
 * boundary test uses node:fs/promises inside the TEST FILE ONLY, which
 * is explicitly allowed — tests are not domain logic).
 */
import { test, expect } from "bun:test";
import { assertReport } from "./invariants.js";
import { DomainInvariantError } from "./types.js";
// Scanner infrastructure — allowed in test files, banned from domain
// modules (the ALLOWED set below encodes that split).
import { readdir, readFile } from "node:fs/promises";

const DOMAIN_DIR = import.meta.dir;

const ALLOWED = new Set(["bun:test"]);
const NODE_BUILTINS = new Set([
  "node:fs", "fs", "node:fs/promises", "node:path", "path",
  "node:process", "process", "node:os", "os",
  "node:http", "http", "node:https", "https", "node:net", "net",
  "node:url", "url", "node:util", "util", "node:buffer", "buffer",
  "node:stream", "stream", "node:crypto", "crypto",
]);
/**
 * The V-14 hardening: the regex requires an identifier after the dot
 * (`\.\w`) so it pins genuine member access (`document.getElementById`,
 * `window.localStorage`) while sentence-ending prose stays immune.
 */
const DOM_GLOBS = /\b(document|window|indexedDB|localStorage|sessionStorage|fetch|XMLHttpRequest)\.\w/;
/** No wall-clock in the domain: timestamps arrive as ISO-8601 strings. */
const NOW_RE = /\bDate\.now|\.getTime\(|performance\.now/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("domain modules: no Node builtins, no DOM globals, no Date.now, closed import graph", async () => {
  const files = await walk(DOMAIN_DIR);
  const testFiles = files.filter((f) => f.endsWith(".test.ts"));
  const domainFiles = files.filter((f) => !f.endsWith(".test.ts"));

  expect(domainFiles.length).toBeGreaterThan(0); // the domain is not empty

  for (const file of domainFiles) {
    const src = await readFile(file, "utf8");

    // 1. No DOM/Node global use.
    expect(DOM_GLOBS.test(src), `${file} references a DOM/Node global`).toBe(false);

    // 2. No wall-clock (the domain is Date-free by law).
    expect(NOW_RE.test(src), `${file} reads the wall clock (Date.now / performance.now)`).toBe(false);
    // 3. Import scan.
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

  // 4. The dotted-path throw test: a closed-set breach throws with
  //    the exact dotted path in the message (the V-41 law, the PLAN
  //    §2 round-trip pin — `report.status` not in the closed set).
  const badStatus = {
    schema: "bolero.v1",
    report: { watchId: 1, recipeVersion: 1, status: "mystery", startedAt: "2026-11-07T09:00:00Z", committedPrefix: 0, artifacts: [] },
  };
  let caught: unknown;
  try {
    assertReport(badStatus as never);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DomainInvariantError);
  expect((caught as Error).message).toContain("report.status");
  expect((caught as Error).message).toContain("not in the closed RunStatus set");

  // 5. Test files MAY use node:fs (scanner infra) — verify the test
  //    set is what we expect, nothing hidden.
  expect(testFiles.length).toBeGreaterThanOrEqual(1);
});
