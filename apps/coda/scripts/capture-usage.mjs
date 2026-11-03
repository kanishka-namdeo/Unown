#!/usr/bin/env bun
/**
 * Coda — the usage-capture lane (the doc-truth round's T3, 2026-11-03).
 *
 * Productizes the operator-side blog-capture precedent in-repo: boots the
 * REAL app via `serve.mjs` on a scratch port, drives the SAME interactions
 * the e2e spec drives (`e2e/coda-offline.spec.ts` — New note → fill
 * title/body → Save → "Saved."; Add task via the pre-armed one-shot dialog
 * lane → "Task created."), and stills the two honest states through the
 * real UI at 1280x800 / deviceScaleFactor 2:
 *
 *   01-fresh-boot.png — the app at "Ready." on a fresh context (seeded
 *                       state, no user data)
 *   02-in-use.png     — the app AFTER the interactions (the real note +
 *                       the real task in the DOM)
 *
 * Output: `public/landing/coda/` (+ a PROVENANCE.md sidecar). The lane
 * never regenerates for a new consumer (the sota-round convention) — the
 * sidecar is the media's receipt.
 *
 * Zero new dependencies: Playwright + Chromium resolve upward from the
 * root `node_modules` exactly as `e2e/` does (Coda's zero-dep law extends
 * to its scripts). Run with `bun` from anywhere:
 *
 *   bun apps/coda/scripts/capture-usage.mjs [--port 4099]
 *
 * Exit 0 = both stills written; any failure prints the reason and exits 1.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CODA_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(CODA_ROOT, "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "public", "landing", "coda");

// Coda's zero-dep law: @playwright/test resolves upward from the repo
// root's node_modules (the e2e lane's own resolution).
const { chromium } = await import("@playwright/test");

const PORT = Number(process.argv[2] === "--port" ? process.argv[3] : 4099);
const VIEWPORT = { width: 1280, height: 800 };
const READY = "Ready.";

function fail(msg) {
  console.error(`[coda-capture] ${msg}`);
  process.exit(1);
}

// 1. Boot the real dev server on a scratch port (the e2e webServer's own
//    command, env-parametrized), waiting for its real ready line.
console.log(`[coda-capture] booting serve.mjs on port ${PORT}`);
const serveScript = resolve(SCRIPT_DIR, "serve.mjs");
const server = spawn(process.execPath || "bun", [serveScript], {
  cwd: REPO_ROOT,
  env: { ...process.env, CODA_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
server.on("error", (e) => fail(`serve.mjs failed to spawn: ${e.message}`));
const base = `http://127.0.0.1:${PORT}`;

let serverReady = false;
const serverOutput = { buffer: "" };
server.stdout.on("data", (d) => {
  serverOutput.buffer += d.toString("utf8");
  if (serverOutput.buffer.includes('[coda] serving')) {
    serverReady = true;
  }
});
for (let i = 0; i < 50 && !serverReady; i++) {
  await new Promise((r) => setTimeout(r, 100));
}
if (!serverReady) fail("serve.mjs did not announce ready within 5 s");

// 2. The real browser, one fresh context (no SW, no IndexedDB — the
//    e2e spec's own starting state).
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn(`[coda-capture] page error: ${e.message}`));

  await page.goto(base, { waitUntil: "domcontentloaded" });
  // The app's real ready marker (app.ts boot(): IDB load → seed → renderAll
  // → status "Ready."). No fixed sleeps anywhere.
  await page.locator("#coda-status").filter({ hasText: READY }).waitFor({ timeout: 30_000 });

  mkdirSync(OUT_DIR, { recursive: true });
  const p1 = resolve(OUT_DIR, "01-fresh-boot.png");
  await page.screenshot({ path: p1, fullPage: true });
  console.log(`[coda-capture] wrote ${p1}`);

  // 3. The e2e spec's interactions, verbatim helper behavior:
  //    New note → fill title + body → Save → "Saved."
  await page.getByRole("button", { name: "New" }).click();
  await page.getByLabel("Note title").fill("Welcome to Coda");
  await page
    .getByLabel("Note body (markdown)")
    .fill("# First note\n\nYour notes stay in this browser — markdown that round-trips to `.md` files, with a task board beside it.");
  await page.getByRole("button", { name: "Save" }).click();
  await page
    .locator("#coda-status")
    .filter({ hasText: "Saved." })
    .waitFor({ timeout: 10_000 });

  //    Add task via the pre-armed one-shot dialog lane (the round's
  //    lesson: register BEFORE the click; a missed prompt auto-dismisses
  //    and cancels the flow).
  const handler = (d) => d.accept("Ship the Coda usage capture");
  page.on("dialog", handler);
  try {
    await page.getByRole("button", { name: "Add task" }).click();
    await page
      .locator("#coda-status")
      .filter({ hasText: "Task created." })
      .waitFor({ timeout: 10_000 });
    await page
      .locator(".coda-task-list .coda-task", { hasText: "Ship the Coda usage capture" })
      .waitFor({ state: "visible", timeout: 10_000 });
  } finally {
    page.off("dialog", handler);
  }

  // 4. The in-use still: the notes list, the open editor, and the task
  //    board — all the real DOM the interactions just wrote.
  const p2 = resolve(OUT_DIR, "02-in-use.png");
  await page.screenshot({ path: p2, fullPage: true });
  console.log(`[coda-capture] wrote ${p2}`);

  // 5. The sidecar receipt — the lane never regenerates for a new consumer,
  //    so the provenance lands next to the media.
  const provenance = `# Coda usage stills — provenance

- Captured: ${new Date().toISOString()} by \`apps/coda/scripts/capture-usage.mjs\` (T3, the doc-truth round).
- Server: \`bun apps/coda/scripts/serve.mjs\` on scratch port ${PORT} (the real transpiling dev server, no build step).
- Browser: headless Chromium (the e2e lane's own install), fresh context — no service worker state, no IndexedDB.
- Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 2, full-page screenshots.
- 01-fresh-boot.png — the app at its real ready marker (\`#coda-status\` = "Ready."), seeded state, before any user data.
- 02-in-use.png — after the e2e spec's own interactions: New note ("Welcome to Coda", saved to "Saved.") + Add task via the pre-armed one-shot dialog lane ("Task created.").
- Re-runnable: \`bun apps/coda/scripts/capture-usage.mjs [--port P]\` — output overwrites the stills in place.
`;
  writeFileSync(resolve(OUT_DIR, "PROVENANCE.md"), provenance);
  console.log(`[coda-capture] wrote ${resolve(OUT_DIR, "PROVENANCE.md")}`);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
console.log("[coda-capture] done — both stills + provenance written.");
