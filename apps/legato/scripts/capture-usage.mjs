#!/usr/bin/env bun
/**
 * capture-usage.mjs — Legato's usage-capture lane (ticket L-12, the
 * chaconne/fugue pattern ported: apps/chaconne/scripts/capture-usage.mjs,
 * apps/fugue/scripts/capture-usage.mjs).
 *
 * Boots the REAL app via the app-root serve.mjs on 4017 (LEGATO_PORT —
 * the capture lane reuses the app's own reserved port: the e2e config's
 * reuseExistingServer lets a dev server own it, and the PLAN §5.1 port
 * discipline keeps one owner per port) + the REAL fixture engine
 * (scripts/fixture-server.mjs) on 4018 (LEGATO_FIXTURE_PORT, the B-16
 * substrate), and stills six honest states at 1280x800 / deviceScaleFactor
 * 2 (2560x1600 IHDR), light scheme — the band's identity set:
 *
 *   01-empty-light.png        — the honest empty state ("No clips yet")
 *   02-list-light.png        — the clip list seeded with REAL clips,
 *                               clipped through the app's own keyboard
 *                               clip flow against the 4018 fixtures
 *   03-detail-highlight-light.png — the reading view + one highlight
 *   04-palette-light.png     — the command palette open (identity shot)
 *   05-filterbar-light.png   — the tag filter bar (tags seeded via the
 *                               app's own tag editor)
 *   06-hostile-light.png     — the hostile-clip honest outcomes
 *                               (degraded rows: the taxonomy lanes)
 *
 * Zero live network: every clip URL is a 127.0.0.1:4018 fixture.
 * One fresh context per still (no IDB/SW leftovers).
 *
 * Re-runnable: bun apps/legato/scripts/capture-usage.mjs [out-dir]
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = resolve(
  process.argv[2] ?? resolve(REPO_ROOT, "public", "landing", "legato"),
);
const APP_PORT = 4017;
const FIX_PORT = 4018;
const FX = `http://127.0.0.1:${FIX_PORT}`;

const fixture = spawn("bun", [resolve(REPO_ROOT, "apps/legato/scripts/fixture-server.mjs")], {
  cwd: REPO_ROOT,
  stdio: ["ignore", "pipe", "inherit"],
});
const app = spawn("bun", [resolve(REPO_ROOT, "apps/legato/serve.mjs")], {
  cwd: REPO_ROOT,
  env: { ...process.env, LEGATO_PORT: String(APP_PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
for (const [name, port] of [["fixture", FIX_PORT], ["app", APP_PORT]]) {
  const ok = await new Promise((res) => {
    const t0 = Date.now();
    (async function poll() {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        res(r.ok);
      } catch {
        if (Date.now() - t0 > 10_000) res(false);
        else setTimeout(poll, 250);
      }
    })();
  });
  if (!ok) {
    console.error(`[legato-capture] ${name} server did not come up on ${port}`);
    fixture.kill(); app.kill(); process.exit(1);
  }
}

const { chromium } = await import("@playwright/test");
const browser = await chromium.launch();

async function ctx() {
  const c = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    baseURL: `http://127.0.0.1:${APP_PORT}`,
  });
  const page = await c.newPage();
  return { c, page };
}

async function still(page, name) {
  // Viewport-clipped (not fullPage): the band's declared dims are
  // 2560x1600 (1280x800 @ DSF 2), matching the fugue/chaconne precedent.
  await page.screenshot({ path: resolve(OUT_DIR, name) });
  console.log(`[legato-capture] ${name}`);
}

/** Open the palette via Ctrl+K and dispatch a command by its data-cmd id. */
async function paletteCmd(page, id) {
  await page.keyboard.press("Control+k");
  // The palette input auto-focuses; type the filter to narrow the list.
  const q = id === "clip-url" ? "clip" : id;
  await page.keyboard.type(q);
  await page.keyboard.press("Enter");
}

/** Seed clips through the app's own keyboard clip flow. */
async function clip(page, url) {
  await paletteCmd(page, "clip-url");
  const input = page.locator(".legato-clip-input");
  await input.waitFor({ timeout: 10_000 });
  await input.fill(url);
  await page.keyboard.press("Enter");
  await page.locator("#legato-status").filter({ hasText: "Clipped" }).waitFor({ timeout: 30_000 });
}

async function openDetailAt(page, idx) {
  // Focus the nth row, then press Enter (the app's own keyboard lane).
  const row = page.locator(".legato-clip-row").nth(idx);
  await row.waitFor({ timeout: 10_000 });
  await row.focus();
  await page.keyboard.press("Enter");
}

mkdirSync(OUT_DIR, { recursive: true });

try {
  // (a) the empty state
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await still(page, "01-empty-light.png");
    await c.close();
  }

  // (b) the list with REAL clips (the app's own clip flow, 4018 fixtures)
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await clip(page, `${FX}/fixtures/clean.html`);
    await clip(page, `${FX}/redirect-chain`);
    await clip(page, `${FX}/fixtures/paywall-excerpt.html`);
    await page.locator(".legato-clip-row").nth(0).waitFor();
    await still(page, "02-list-light.png");
    await c.close();
  }

  // (c) the reading view with a highlight
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await clip(page, `${FX}/fixtures/clean.html`);
    await openDetailAt(page, 0);
    const body = page.locator(".legato-detail-body");
    await body.waitFor();
    await body.evaluate((el) => {
      const p = el.querySelector("p");
      if (!p) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // focus the body so the 'h' keydown handler (detail.ts's body
      // keydown lane) sees the selection.
      el.setAttribute("tabindex", "-1");
      el.focus();
    });
    await page.keyboard.press("h");
    await page.locator("mark.legato-highlight-span").first().waitFor({ timeout: 10_000 });
    await still(page, "03-detail-highlight-light.png");
    await c.close();
  }

  // (d) the palette open
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await page.keyboard.press("Control+k");
    await page.locator("#legato-palette").waitFor();
    await still(page, "04-palette-light.png");
    await c.close();
  }

  // (e) the tag filter bar (tags seeded via the app's own tag editor)
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await clip(page, `${FX}/fixtures/clean.html`);
    await clip(page, `${FX}/redirect-chain`);
    // Focus the first row and open the detail view with Enter.
    await page.locator(".legato-clip-row").nth(0).click();
    await page.keyboard.press("Enter");
    await page.locator("#legato-detail").waitFor();
    // Open the tag editor ('t' in detail view).
    await page.keyboard.press("t");
    const editor = page.locator("#legato-tag-editor");
    await editor.waitFor({ timeout: 5_000 });
    const input = editor.locator(".legato-tag-editor-input");
    await input.fill("reading");
    await input.press("Enter");
    // The editor re-renders in place after Enter (stays open); close it.
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached", timeout: 5_000 });
    // Close the detail view.
    await page.keyboard.press("Escape");
    // Move to the second row and open its detail view.
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.locator("#legato-detail").waitFor({ timeout: 5_000 });
    // Open the second clip's tag editor.
    await page.keyboard.press("t");
    const editor2 = page.locator("#legato-tag-editor");
    await editor2.waitFor({ timeout: 5_000 });
    const input2 = editor2.locator(".legato-tag-editor-input");
    await input2.fill("reference");
    await input2.press("Enter"); // add the tag (editor re-renders, stays open)
    await page.keyboard.press("Escape"); // close the tag editor
    await editor2.waitFor({ state: "detached", timeout: 5_000 });
    // Close the detail view.
    await page.keyboard.press("Escape");
    // The filter bar renders in the list pane when tags exist.
    await page.locator(".legato-filter-group").waitFor({ timeout: 10_000 });
    await still(page, "05-filterbar-light.png");
    await c.close();
  }

  // (f) the hostile-clip honest outcomes (the degraded rows)
  {
    const { c, page } = await ctx();
    await page.goto("/");
    await page.locator("#legato-empty").waitFor();
    await clip(page, `${FX}/walled-403`);
    await clip(page, `${FX}/fixtures/wrong-charset.html`);
    await page.locator(".legato-clip-row").last().waitFor();
    await page.locator(".legato-clip-degraded").first().waitFor({ timeout: 15_000 });
    await still(page, "06-hostile-light.png");
    await c.close();
  }

  console.log("[legato-capture] all stills written to", OUT_DIR);
} finally {
  await browser.close();
  fixture.kill("SIGTERM");
  app.kill("SIGTERM");
}
