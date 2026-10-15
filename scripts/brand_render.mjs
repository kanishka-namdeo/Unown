#!/usr/bin/env node
/**
 * brand_render.mjs — renders the Unown brand assets (README banner + GitHub
 * social preview) from download/brand/*.html via headless chromium.
 *
 * Usage: bun scripts/brand_render.mjs
 * Output: download/brand/banner.png (3232x840, dsf 2)
 *         download/brand/social@2x.png (2560x1280, dsf 2 — downscale to
 *         1280x640 happens later in curate_assets.mjs)
 *
 * Fonts load from Google Fonts (Geist / Geist Mono) — needs network.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PW = join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs");
const { chromium } = await import(pathToFileURL(PW).href);

import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

function findChrome() {
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    if (!d.startsWith("chromium-")) continue;
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
});

async function render(htmlFile, pngFile, w, h) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(process.cwd(), "download", "brand", htmlFile)).href, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  // Ensure webfonts are actually loaded before shooting.
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(process.cwd(), "download", "brand", pngFile) });
  await ctx.close();
  console.log(`rendered ${pngFile}`);
}

try {
  await render("banner.html", "banner.png", 1616, 420);
  await render("social.html", "social@2x.png", 1280, 640);
} finally {
  await browser.close();
}
