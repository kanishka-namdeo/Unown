/**
 * Chaconne runner — the ONE real-browser smoke (PLAN §3: "the real
 * adapter's iframe/verify-value-landed behavior is pinned by exactly
 * ONE real-browser smoke per ticket (C-2)").
 *
 * LOCAL fixtures only — never live network. The fixture set ships
 * under test/fixtures/ and is addressed via file:// URLs so no server
 * is needed (edge cases 2/3/4: a blank control, an iframe-hosted
 * field, a tall page's fullPage capture).
 *
 * Self-skip-guard (the bolero BOLERO_E2E pattern): the smoke arms ONLY
 * under `CHACONNE_REAL_SMOKE=1` — set by the CI step that runs AFTER
 * "Chromium for Playwright" (and by a local `bunx playwright install
 * chromium" first). Every other lane — Lane A (`cd apps/chaconne &&
 * bun test`, the DOM-free enforcement lane that runs BEFORE any browser
 * exists in CI), Lane B, the root landing battery — sees the suite SKIP
 * with the arm hint instead of failing on a missing binary. This keeps
 * PLAN §4 risk #1's loudness where a browser was PROMISED, without
 * reddening lanes that never had one.
 */
import { test, expect } from "bun:test";
import * as path from "node:path";
import { makeRealAdapter } from "./real-adapter.js";
import { FakePageAdapter } from "./page-adapter.js";
import { executeRecipe } from "./index.js";
import type { Recipe, Step } from "../src/domain/types.js";

type StepDef = Omit<Step, "id">;

const CHACONNE_REAL_SMOKE = process.env.CHACONNE_REAL_SMOKE === "1";

/** The guard: skip unless the marker armed the lane (browser present). */
function realSmoke(name: string, body: () => Promise<void>, timeout?: number) {
  if (CHACONNE_REAL_SMOKE) {
    test(name, body, timeout);
  } else {
    test.skip(`[real-smoke] CHACONNE_REAL_SMOKE=1 arms this (bunx playwright install chromium first)`, body, timeout);
  }
}

const FIXTURES = path.resolve(import.meta.dir, "..", "test", "fixtures");
const fileUrl = (name: string) => `file://${path.join(FIXTURES, name)}`;

function recipe(steps: StepDef[], name = "real-smoke"): Recipe {
  return { id: 1, name, version: 1, steps: steps.map((s, i) => ({ ...s, id: i + 1 })) };
}

realSmoke("real-adapter smoke: fill + verify-value-landed on an iframe field (the #43 cure)", async () => {
  const adapter = await makeRealAdapter();
  const r = recipe([
    { kind: "goto", selector: fileUrl("form-iframe.html") },
    { kind: "fill", selector: "#name", value: "ada-lovelace" },
    { kind: "fill", selector: "#token", value: "tok-42", intoFrame: "inner" },
    { kind: "assert-text", selector: "#status", value: "idle" },
  ]);
  const res = await executeRecipe(adapter, r);
  await adapter.close?.();
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(4);
}, 30_000);

realSmoke("real-adapter smoke: a capped wait on a blank page → selector-not-found, NOT a hang", async () => {
  const adapter = await makeRealAdapter();
  const r = recipe([
    { kind: "goto", selector: fileUrl("blank.html") },
    // A short cap: the taxonomy entry must surface well inside it.
    { kind: "wait", selector: "#ghost", timeoutMs: 800 },
  ]);
  const t0 = Date.now();
  const res = await executeRecipe(adapter, r);
  const elapsed = Date.now() - t0;
  await adapter.close?.();
  expect(res.status).toBe("selector-not-found");
  expect(res.committedPrefix).toBe(1);
  expect(elapsed).toBeLessThan(10_000); // bounded — the cap is 800ms + overhead
}, 30_000);

realSmoke("real-adapter smoke: tall page — fullPage screenshot + a bottom element is assertable", async () => {
  const adapter = await makeRealAdapter();
  const r = recipe([
    { kind: "goto", selector: fileUrl("tall.html") },
    { kind: "assert-element", selector: "#bottom" },
    { kind: "extract", selector: "#bottom", value: "data-attr" },
    { kind: "screenshot", selector: "#" },
  ]);
  const res = await executeRecipe(adapter, r);
  await adapter.close?.();
  expect(res.status).toBe("ok");
  expect(res.extracted["2"]).toBe("end"); // the tall page's bottom marker
  // The screenshot artifact is a real PNG (fullPage: bytes > 0, PNG magic).
  const shot = res.artifacts.find((a) => a.ext === "png");
  expect(shot).toBeDefined();
  const bytes = shot!.payload as Uint8Array;
  expect(bytes.length).toBeGreaterThan(1000);
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
}, 30_000);
