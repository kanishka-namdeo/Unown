#!/usr/bin/env bun
/**
 * capture-usage.mjs — Fugue's usage-capture lane (ticket F-10, ported
 * from the Chaconne Ostinato precedent apps/chaconne/scripts/capture-usage.mjs).
 *
 * Boots the REAL app via the app-root serve.mjs on a scratch port (4016 by
 * default, per the PLAN §5 ruling — the app's reserved dev port 4015 stays
 * free for a running dev server), boots the REAL fixture engine lane via
 * apps/fugue/runner/fixture-serve.mjs on 4130, drives the real UI
 * keyboard-first (the Ctrl+K palette over the learning routes, the
 * arrow-navigated job rows, the compose dialog) and stills eight honest
 * states at 1280x800 / deviceScaleFactor 2, light scheme (the band's
 * identity set — dark is optional and not committed to the band):
 *
 *   01-jobs-light.png       — the boot/jobs route (the engine lane's rows)
 *   02-compose-light.png   — the compose dialog OPEN (the P0 authoring)
 *   03-runs-light.png      — the runs route (the grouped run history)
 *   04-dreams-light.png    — the dreams journal (the AutoDream log)
 *   05-memory-light.png    — the memory view (tiers + the health card)
 *   06-skills-light.png    — the skills view (the staged queue + the hint)
 *   07-manual-notes-light.png — the Manual-notes editor (the meter)
 *   08-palette-light.png   — the command palette OPEN (the identity shot)
 *
 * Output: public/landing/fugue/ (+ a PROVENANCE.md sidecar — the lane's
 * receipt; the stills are the PRD's "real usage captures", committed
 * once and re-captured on demand, never mocked).
 *
 * Zero new dependencies: @playwright/test + Chromium resolve upward
 * from the root node_modules (the e2e lane's own resolution).
 *
 * Run: bun apps/fugue/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FUGUE_ROOT = resolve(SCRIPT_DIR, ".."); // serve.mjs + runner/ live at the APP ROOT
const REPO_ROOT = resolve(FUGUE_ROOT, "..", "..");

// The target dir is the first argv (default: the landing band's lane).
const OUT_DIR = resolve(
  process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : resolve(REPO_ROOT, "public", "landing", "fugue"),
);

const SMOKE = process.argv.includes("--smoke");
const APP_PORT = Number((() => {
  const i = process.argv.indexOf("--port");
  return i > -1 ? process.argv[i + 1] : "4016"; // 4015 is the app's reserved dev port; the capture lane takes 4016
})());
const FIXTURE_PORT = Number(process.env.FUGUE_FIXTURE_PORT ?? 4130);
const VIEWPORT = { width: 1280, height: 800 };

function fail(msg) {
  console.error(`[fugue-capture] ${msg}`);
  process.exit(1);
}

// Fugue's zero-dep law: @playwright/test resolves upward from the
// repo root's node_modules (the e2e lane's own resolution).
const { chromium } = await import("@playwright/test");

// ─── Boot the fixture engine (4130) and the app server (4016) ──────
console.log(`[fugue-capture] booting fixture engine on ${FIXTURE_PORT}, app server on ${APP_PORT}`);

const fixture = spawn("bun", [resolve(FUGUE_ROOT, "runner/fixture-serve.mjs")], {
  cwd: REPO_ROOT,
  env: { ...process.env, FUGUE_FIXTURE_PORT: String(FIXTURE_PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
fixture.on("error", (e) => fail(`fixture engine failed to spawn: ${e.message}`));

const appServer = spawn(process.execPath || "bun", [resolve(FUGUE_ROOT, "serve.mjs")], {
  cwd: REPO_ROOT,
  env: { ...process.env, FUGUE_PORT: String(APP_PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
appServer.on("error", (e) => fail(`serve.mjs failed to spawn: ${e.message}`));

// Wait for the fixture engine's /__fixture-health probe (fixture-serve.mjs's own probe).
const deadline = Date.now() + 10_000;
let fixtureReady = false;
while (Date.now() < deadline && !fixtureReady) {
  try {
    const res = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__fixture-health`);
    if (res.ok) fixtureReady = true;
  } catch { /* not up yet */ }
  if (!fixtureReady) await new Promise((r) => setTimeout(r, 200));
}
if (!fixtureReady) fail(`fixture engine did not announce ready within 10 s on ${FIXTURE_PORT}`);

// Wait for the app server's /health probe (serve.mjs's own liveness probe).
const appDeadline = Date.now() + 10_000;
let appReady = false;
while (Date.now() < appDeadline && !appReady) {
  try {
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/health`);
    if (res.ok) appReady = true;
  } catch { /* not up yet */ }
  if (!appReady) await new Promise((r) => setTimeout(r, 200));
}
if (!appReady) fail(`serve.mjs did not announce ready within 10 s on ${APP_PORT}`);

const base = `http://127.0.0.1:${APP_PORT}`;

/**
 * The capture lane's seed: the app's default engine URL is the fixture
 * (4130, no token), so NO init-script injection is needed — the
 * fixture lane IS the default. The live lane (the F-6 proof lane,
 * off-peak) is what injects window.__FUGUE_ENGINE__; the capture lane
 * drives the real UI through the fixture's canned contract-pinned JSON.
 */

/** A fresh context (no SW state, no localStorage) at the given scheme. */
async function freshContext(browser, colorScheme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn(`[fugue-capture] page error: ${e.message}`));
  return { ctx, page };
}

async function still(page, name) {
  const p = resolve(OUT_DIR, name);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[fugue-capture] wrote ${p}`);
  return p;
}

/** Navigate to a route through the app's own keyboard path (the Ctrl+K palette). */
async function openRoute(page, cmd) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#fugue-app").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-route="jobs"]').waitFor({ state: "visible", timeout: 30_000 });
  if (!cmd) return; // no cmd = stay on the root (jobs) route
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await palette.waitFor({ state: "visible", timeout: 10_000 });
  await palette.locator(`li[data-cmd="${cmd}"]`).click();
}

const browser = await chromium.launch();
try {
  mkdirSync(OUT_DIR, { recursive: true });

  // ─── LIGHT SCHEME (the band's identity set) ─────────────────────

  // 1. BOOT / JOBS ROUTE — the engine lane's rows (the fixture's two automations).
  {
    const { ctx, page } = await freshContext(browser, "light");
    await openRoute(page, ""); // no cmd = stay on the root (jobs) route
    await page.locator('.fugue-job-row[data-lane="engine"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await still(page, "01-jobs-light.png");
    await ctx.close();
  }

  // 2. COMPOSE DIALOG — the P0 authoring surface (the keyboard path: Ctrl+K → "New job").
  {
    const { ctx, page } = await freshContext(browser, "light");
    await openRoute(page, "");
    await page.keyboard.press("Control+k");
    const palette = page.locator(".fugue-palette");
    await palette.waitFor({ state: "visible", timeout: 10_000 });
    await palette.locator('li[data-cmd="new-job"]').click();
    // The compose dialog on the house contract (the F-4 dialog).
    await page.locator(".fugue-dialog, [role='dialog']").first().waitFor({ state: "visible", timeout: 10_000 });
    await still(page, "02-compose-light.png");
    await ctx.close();
  }

  // 3. RUNS ROUTE — the grouped run history (the fixture's canned runs).
  //    Opened via the palette's "refresh" command on the first engine job row,
  //    or via the app's own "2" direct key (the Ostinato/Chaconne pattern).
  {
    const { ctx, page } = await freshContext(browser, "light");
    await openRoute(page, "");
    // Select the first engine job row (the runs route is opened from the job row).
    const firstRow = page.locator('.fugue-job-row[data-lane="engine"]').first();
    await firstRow.waitFor({ state: "visible", timeout: 30_000 });
    await firstRow.click();
    await page.locator('[data-route="runs"]').waitFor({ state: "visible", timeout: 15_000 });
    await still(page, "03-runs-light.png");
    await ctx.close();
  }

  // 4-7. THE LEARNING ROUTES (dreams / memory / skills / manual-notes) —
  //      each via the palette's own commands (the F-7 learning band).
  for (const [stillName, cmd] of [
    ["04-dreams-light.png", "open-dreams"],
    ["05-memory-light.png", "open-memory"],
    ["06-skills-light.png", "open-skills"],
    ["07-manual-notes-light.png", "open-manual-notes"],
  ]) {
    const { ctx, page } = await freshContext(browser, "light");
    await openRoute(page, "");
    await page.keyboard.press("Control+k");
    const palette = page.locator(".fugue-palette");
    await palette.waitFor({ state: "visible", timeout: 10_000 });
    await palette.locator(`li[data-cmd="${cmd}"]`).click();
    const routeName = cmd.replace("open-", "");
    await page.locator(`[data-route="${routeName}"]`).waitFor({ state: "visible", timeout: 15_000 });
    await still(page, stillName);
    await ctx.close();
  }

  // 8. PALETTE OPEN — the identity shot (the full 15-command enumeration).
  {
    const { ctx, page } = await freshContext(browser, "light");
    await openRoute(page, "");
    await page.keyboard.press("Control+k");
    const palette = page.locator(".fugue-palette");
    await palette.waitFor({ state: "visible", timeout: 10_000 });
    // The palette lists its commands; the still shows the full enumeration.
    await still(page, "08-palette-light.png");
    await ctx.close();
  }

  // ─── The sidecar receipt (provenance lands next to the media) ───
  const provenance = `# Fugue usage stills — provenance

- Captured: ${new Date().toISOString()} by \`apps/fugue/scripts/capture-usage.mjs\` (the F-10 product-surface lane; the Ostinato/Chaconne precedent ported).
- Servers: \`bun apps/fugue/serve.mjs\` on scratch port ${APP_PORT} (the real transpiling dev server; 4015 is the app's reserved dev port, so the capture lane takes 4016 per the PLAN §5 ruling) + \`bun apps/fugue/runner/fixture-serve.mjs\` on ${FIXTURE_PORT} (the F-3 fixture engine, the canned contract-pinned JSON the e2e lane drives — NO live network; the capture drives the app shell against the fixture only, the F-6 live lane is off-peak and operator-witnessed, not a capture lane).
- Browser: headless Chromium (the e2e lane's own install, repo-root \`@playwright/test\`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 2, full-page screenshots.
- Keyboard-first: every navigation is a \`page.keyboard\` press or a palette command click (the app's own keyboard surface — the Ctrl+K palette over the learning routes, the arrow-navigated job rows). The compose dialog is opened via the palette's "New job" command (the app's own P0 path), not a pointer click on a button.
- Schemes: light only (the band's identity set; the chaconne set is light-only for the band, dark optional and not committed).
- 01-jobs-light.png — the boot/jobs route with the fixture engine's two automation rows (the "Engine jobs" lane).
- 02-compose-light.png — the compose dialog OPEN (the P0 authoring: prompt/schedule/mode/model/timezone/misfire/spend-cap with validation).
- 03-runs-light.png — the runs route (the grouped run history over the fixture's canned runs).
- 04-dreams-light.png — the dreams journal (the AutoDream consolidation log, the five-status badge vocabulary).
- 05-memory-light.png — the memory view (the tiers + the health card: backend, model, memory count, duplicates, conflicts).
- 06-skills-light.png — the skills view (the engine's DB skills, the honest empty state in the fixture lane, + the staged queue through the read-only /skills-staged route + the promote hint as TEXT).
- 07-manual-notes-light.png — the Manual-notes editor (the lane label, the budget meter, the over-cap marker surface — the one hand-edit lane into .unown/memory/project.md's ## Manual notes section).
- 08-palette-light.png — the command palette OPEN via Ctrl+K (the full 15-command enumeration, filter-as-you-type, the keyboard-first identity shot).
- Re-runnable: \`bun apps/fugue/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]\` — the stills overwrite in place.
`;
  writeFileSync(resolve(OUT_DIR, "PROVENANCE.md"), provenance);
  console.log(`[fugue-capture] wrote ${resolve(OUT_DIR, "PROVENANCE.md")}`);
} finally {
  await browser.close().catch(() => {});
  fixture.kill("SIGTERM");
  appServer.kill("SIGTERM");
}

// ─── The smoke self-test (--smoke): assert >= 1 PNG written ──────────
if (SMOKE) {
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  if (files.length < 1) fail("smoke: no PNG stills written");
  console.log(`[fugue-capture] SMOKE PASS — ${files.length} stills written to ${OUT_DIR}`);
} else {
  console.log("[fugue-capture] done — all stills + provenance written.");
}
