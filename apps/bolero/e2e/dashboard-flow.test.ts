/**
 * Bolero dashboard — the ONE flow lane (ticket S-5 e2e, the §6 e2e
 * config's keyboard-only K-1 pattern).
 *
 * LOCAL loopback only — the real API server on 4050 (a fresh SQLite
 * store, no seeding of the tracked data dir) + serve.mjs on 4051
 * (the reverse-proxy topology, §5). One watch + one ok run carrying
 * a real 1x1 PNG artifact (the `__artifactBytes__` sideband, the
 * real ingest path) + one failed run, all registered through
 * POST /api/watches + POST /api/runs — no test-only API, no seeded
 * DB.
 *
 * KEYBOARD-ONLY flow, zero pointer events:
 *   1. load the dashboard on 4051 (the API proxies through), the
 *      watch row is visible with its lastStatus
 *   2. Enter opens the detail view
 *   3. the run history renders (two rows)
 *   4. the latest screenshot img has naturalWidth > 0 (a real decode
 *      through the artifact route, not a broken src)
 *   5. the failure detail is visible
 *   6. Esc returns to the list, focus is restored on the originating
 *      row (the chaconne focus pattern)
 *
 * Self-skip-guard: this file only runs under the `bolero:e2e` lane
 * (the `BOLERO_E2E=1` marker, the runner-smoke precedent). When the
 * `bolero:test` unit lane picks it up, it self-skips — the unit lane
 * stays browser-free by construction.
 */
import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/** The e2e marker: set by the `bolero:e2e` script's env. */
const BOLERO_E2E = process.env.BOLERO_E2E === "1";

const API_PORT = 4050;
const STATIC_PORT = 4051;

/** A real, decodable 1x1 transparent PNG (67 bytes, valid PNG magic
 *  + IHDR + IDAT + IEND). Hardcoded so the flow lane never leaves
 *  the loopback. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwCA60e6kgAAAABJRU5ErkJggg==";

function apiBase() {
  return `http://127.0.0.1:${API_PORT}`;
}
function staticBase() {
  return `http://127.0.0.1:${STATIC_PORT}`;
}

function appRoot() {
  // This file lives at apps/bolero/e2e/ — the app root is one up.
  return join(import.meta.dir, "..");
}

function repoRoot() {
  return join(import.meta.dir, "..", "..", "..");
}

async function waitPort(port: number, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`port ${port} did not come up within ${ms}ms`);
}

async function bootApiServer(): Promise<{ child: ChildProcess; dataDir: string }> {
  // The real API server (the one-command operator gate). It boots
  // against a fresh temp data dir (BOLERO_DATA_DIR override) so the
  // e2e never depends on external state — the shared app data/ is
  // never touched, clean exit or crash; the finally clause removes it.
  const dataDir = mkdtempSync(join(tmpdir(), "bolero-e2e-"));
  const child = spawn("bun", [join(appRoot(), "src/server/boot.ts")], {
    env: { ...process.env, BOLERO_PORT: String(API_PORT), BOLERO_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  return { child, dataDir };
}

async function bootStaticServer(): Promise<ChildProcess> {
  return spawn("bun", [join(appRoot(), "serve.mjs")], {
    env: {
      ...process.env,
      BOLERO_STATIC_PORT: String(STATIC_PORT),
      BOLERO_PORT: String(API_PORT),
    },
    stdio: "ignore",
  });
}

/** Seed the registry through the REAL ingest path (the operator
 *  ruling: "register a watch" is satisfied by the API, not a UI
 *  form). One watch + one ok run carrying a real PNG + one failed
 *  run — every S-5 read endpoint is exercised in the real topology. */
async function seedRegistry(): Promise<void> {
  const base = apiBase();

  // 1. register the watch.
  const watchRes = await fetch(`${base}/api/watches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "bolero.v1",
      watch: {
        id: 1, // explicit spec-declared id (the ids.ts law — the domain asserts it)
        name: "flow-watch",
        baseUrl: "https://example.com",
        recipeVersion: 1,
        steps: [{ id: 1, kind: "goto", selector: "https://example.com" }],
      },
    }),
  });
  expect(watchRes.status).toBe(201);

  // 2. an ok run carrying a real 1x1 PNG artifact (the sideband).
  // The name IS the sha256 of the bytes (PLAN §1 storage law): hash
  // the real decoded bytes — a constant, so the seed stays deterministic.
  const pngBytes = Buffer.from(TINY_PNG_B64, "base64");
  const pngSha = createHash("sha256").update(pngBytes).digest("hex");
  const pngName = `1_r1_sha256:${pngSha}.png`;
  const okRunRes = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "bolero.v1",
      report: {
        watchId: 1,
        recipeVersion: 1,
        status: "ok",
        startedAt: "2026-11-07T09:00:00Z",
        finishedAt: "2026-11-07T09:00:01Z",
        committedPrefix: 9,
        artifacts: [{ name: pngName, sha256: pngSha, ext: "png" }],
        log: "all 9 steps committed",
      },
      __artifactBytes__: { [pngName]: TINY_PNG_B64 },
    }),
  });
  expect(okRunRes.status).toBe(201);

  // Server round-trip pins content-addressing: the artifact bytes
  // served under pngName must hash to exactly the digest embedded in
  // that name (the digest is computed above, not hardcoded).
  const servedRes = await fetch(`${base}/api/artifacts/${pngName}`);
  expect(servedRes.status).toBe(200);
  const servedSha = createHash("sha256").update(Buffer.from(await servedRes.arrayBuffer())).digest("hex");
  expect(servedSha).toBe(pngSha);

  // 3. a failed run (the failure-detail surface's data).
  const failedRunRes = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "bolero.v1",
      report: {
        watchId: 1,
        recipeVersion: 1,
        status: "step-failed",
        startedAt: "2026-11-07T10:00:00Z",
        finishedAt: "2026-11-07T10:00:02Z",
        committedPrefix: 3,
        failedStepIdx: 4,
        artifacts: [],
        log: "step 4 (click) — selector #go did not appear within 3000ms",
      },
    }),
  });
  expect(failedRunRes.status).toBe(201);
}

test("keyboard-only flow: list → Enter → detail (history + screenshot + failure) → Esc → list + focus on origin", async () => {
  if (!BOLERO_E2E) return; // unit lane: self-skip (no browser, no fixtures)

  let api: ChildProcess;
  let dataDir: string;
  let staticChild: ChildProcess;
  let browser: Browser;
  let page: Page;
  try {
    const boot = await bootApiServer();
    api = boot.child;
    dataDir = boot.dataDir;
    await waitPort(API_PORT);
    await seedRegistry();

    staticChild = await bootStaticServer();
    await waitPort(STATIC_PORT);

    // Real Chromium through the repo's playwright (the walk-up
    // ruling, the Chaconne §4 precedent).
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // 1. load the dashboard on the static server (the API proxies
    //    through to 4050 same-origin — zero CORS by construction).
    await page.goto(staticBase());

    // The watch row is visible with its lastStatus. The failed run
    // is the most recent (id order), so lastStatus is step-failed.
    const row = page.locator(".bolero-row").first();
    await row.waitFor({ state: "visible", timeout: 20_000 });
    expect(await row.getAttribute("data-status")).toBe("step-failed");
    expect((await row.textContent()) ?? "").toContain("flow-watch");

    // 2. Enter opens the detail view (zero pointer events).
    await row.focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-surface='detail']").waitFor({ state: "visible", timeout: 20_000 });

    // 3. the run history renders (two rows — one ok, one step-failed).
    const historyRows = page.locator(".bolero-history li");
    await historyRows.first().waitFor({ state: "visible", timeout: 20_000 });
    expect(await historyRows.count()).toBe(2);

    // 4. the latest screenshot img has naturalWidth > 0 (a real
    //    decode through the artifact route, not a broken src).
    await page.waitForFunction(
      () => {
        const el = document.querySelector<HTMLImageElement>(".bolero-shot img");
        return el !== null && el.naturalWidth > 0;
      },
      undefined,
      { timeout: 20_000 }
    );

    // 5. the failure detail is visible (the step-failed run's log).
    const fail = page.locator(".bolero-fail");
    await fail.waitFor({ state: "visible", timeout: 20_000 });
    expect((await fail.textContent()) ?? "").toContain("step-failed");
    expect((await fail.textContent()) ?? "").toContain("step 4");

    // 6. Esc returns to the list, focus restored on the originating
    //    row (the chaconne focus pattern).
    await page.keyboard.press("Escape");
    await page.locator("[data-surface='list']").waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const rowEl = document.querySelector<HTMLLIElement>(".bolero-row");
        return rowEl !== null && document.activeElement === rowEl;
      },
      undefined,
      { timeout: 20_000 }
    );
  } finally {
    // Kill both spawned processes (the no-orphan rule), then remove
    // the e2e's own temp data dir — the shared app data/ is never
    // touched, so no tracked-state drift can land, clean exit or crash.
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    api?.kill("SIGTERM");
    staticChild?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    try {
      api?.kill("SIGKILL");
      staticChild?.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    // Wipe the e2e's temp data dir (bolero.db + artifacts/).
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  }
}, 90_000);
