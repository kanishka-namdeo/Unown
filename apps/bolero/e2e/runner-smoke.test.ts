/**
 * Bolero runner — the ONE real-browser smoke (the S-2 e2e lane, the
 * Chaconne `real-smoke.test.ts` precedent).
 *
 * LOCAL fixtures only — never live network. The happy-path fixture
 * ships under `../fixtures/happy.html` and is addressed via a
 * `file://` URL so no server is needed (the §6 fixture-first law:
 * the deterministic verifier is the fixture lane; the real browser
 * proves the PlaywrightAdapter's wiring + the screenshot's real-PNG
 * content-addressing).
 *
 * Asserts: a well-formed `RunReport` (the frozen `assertReport`
 * passes) + a real screenshot artifact whose sha256 matches its
 * bytes (PNG magic + digest-of-bytes equality).
 *
 * Self-skip-guard: this file only runs under the `bolero:e2e` lane.
 * The module-scope `BOLERO_E2E=1` marker arms the test; when the
 * `bolero:test` unit lane runs it (bun test picks up every *.test.ts
 * under the app root), the test self-skips — the unit lane stays
 * browser-free by construction (the CODA_E2E/CHACONNE_E2E precedent).
 */
import { test, expect } from "bun:test";
import * as path from "node:path";
import { makePlaywrightAdapter } from "../src/runner/adapter.js";
import { executeWatch } from "../src/runner/executor.js";
import { buildRunReport, sha256Hex } from "../src/runner/report.js";
import { assertReport, assertWatch } from "../src/domain/invariants.js";
import type { WatchSpec } from "../src/domain/types.js";

/** The e2e marker: set by the `bolero:e2e` script's env, never by
 *  the `bolero:test` unit lane (so the smoke self-skips there). */
const BOLERO_E2E = process.env.BOLERO_E2E === "1";

const FIXTURES_DIR = path.resolve(import.meta.dir, "..", "fixtures");
const happyUrl = `file://${path.join(FIXTURES_DIR, "happy.html")}`;

/** The happy-path watch: every step kind, in one frozen recipe. */
function happyWatch(): WatchSpec {
  const w: WatchSpec = {
    schema: "bolero.v1",
    watch: {
      id: 1,
      name: "e2e-smoke",
      baseUrl: happyUrl,
      recipeVersion: 1,
      steps: [
        { id: 1, kind: "goto", selector: happyUrl },
        { id: 2, kind: "fill", selector: "#name", value: "ada-lovelace" },
        { id: 3, kind: "select", selector: "#tier", value: "b" },
        { id: 4, kind: "click", selector: "#go" },
        { id: 5, kind: "wait", selector: "#readout" },
        { id: 6, kind: "assert-text", selector: "#readout", value: "committed" },
        { id: 7, kind: "assert-element", selector: "#go" },
        { id: 8, kind: "extract", selector: "#readout", value: "data-ref" },
        { id: 9, kind: "screenshot", selector: "#" },
      ],
    },
  };
  assertWatch(w);
  return w;
}

test("real-browser smoke: the happy-path fixture commits all 9 steps + the report passes assertReport + the screenshot's sha256 matches its bytes", async () => {
  if (!BOLERO_E2E) return; // unit lane: self-skip (no browser, no fixtures)
  const watch = happyWatch();
  const adapter = await makePlaywrightAdapter();
  let result;
  try {
    result = await executeWatch(adapter, watch);
  } finally {
    await adapter.close?.();
  }
  expect(result.status).toBe("ok");
  expect(result.committedPrefix).toBe(9);
  // The extract step (index 7) read the data-ref attribute.
  expect(result.extracted["7"]).toBe("ref-42");

  // Build the report through the frozen domain path (the V-41 law).
  const report = buildRunReport({
    watchId: watch.watch.id,
    recipeVersion: 1,
    runSeq: 1,
    status: result.status,
    startedAt: "2026-11-07T09:00:00Z",
    finishedAt: "2026-11-07T09:00:01Z",
    committedPrefix: result.committedPrefix,
    extracted: result.extracted,
    artifacts: result.artifacts,
    log: result.logText,
  });
  // The well-formed-report pin: the frozen assertReport PASSES.
  assertReport(report);

  // The real screenshot artifact: PNG magic + sha256-of-bytes match.
  const shot = result.artifacts.find((a) => a.ext === "png");
  expect(shot).toBeDefined();
  const bytes = shot!.payload as Uint8Array;
  expect(bytes.length).toBeGreaterThan(1000); // a real full-page capture
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG magic
  const expectedSha = sha256Hex(bytes);
  const ref = report.report.artifacts.find((a) => a.ext === "png")!;
  expect(ref.sha256).toBe(expectedSha); // the name IS the hash
  expect(ref.name).toBe(`1_r1_sha256:${expectedSha}.png`);
}, 30_000);
