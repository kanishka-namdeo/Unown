#!/usr/bin/env node
/**
 * brand_render.mjs — renders the Unown brand assets (README banner + GitHub
 * social preview) from the TRACKED sources in scripts/brand/*.html via headless
 * chromium, into gitignored download/brand/.
 *
 * Sources are in git and outputs are not: `download/` is gitignored
 * (.gitignore `/download/`), so the PNGs under .github/assets/ must stay
 * regenerable from a clean checkout. curate_assets.mjs still reads its input
 * from download/brand/, which is why the output dir has not moved.
 *
 * Usage: bun scripts/brand_render.mjs
 * Output: download/brand/banner.png    (3232x840, dsf 2 over 1616x420)
 *         download/brand/social@2x.png (2560x1280, dsf 2 over 1280x640 —
 *         curate_assets.mjs downscales it to 1280x640 later)
 *
 * Fonts load from Google Fonts (Geist / Geist Mono) — needs network.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = join(process.cwd(), "scripts", "brand");
const OUT = join(process.cwd(), "download", "brand");
mkdirSync(OUT, { recursive: true });

/* ---------- resolve playwright (scratch install first) ---------- */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);

let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    // Absolute paths / URLs resolve via URL; bare specifiers ("playwright")
    // must stay bare so node resolves them from cwd's node_modules (root
    // devDependencies — the old download/.pwtools scratch is retired).
    const spec = /^[a-z]+:/i.test(c) ? c : c.startsWith("/") ? pathToFileURL(c).href : c;
    const mod = await import(spec);
    chromium = mod.chromium;
    break;
  } catch {
    /* next candidate */
  }
}
if (!chromium) {
  console.error("playwright not resolvable — run `bun add playwright` in download/.pwtools/");
  process.exit(1);
}

function findChrome() {
  const roots = [
    join(homedir(), "AppData", "Local", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ];
  const subs = [
    "chrome-win64/chrome.exe",
    "chrome-win/chrome.exe",
    "chrome-linux64/chrome",
    "chrome-linux/chrome",
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      if (!d.startsWith("chromium-")) continue;
      for (const sub of subs) {
        const p = join(root, d, sub);
        if (existsSync(p)) return p;
      }
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
  await page.goto(pathToFileURL(join(SRC, htmlFile)).href, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  // Ensure webfonts are actually loaded before shooting.
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, pngFile) });
  await ctx.close();
  console.log(`rendered ${pngFile}`);
}

try {
  await render("banner.html", "banner.png", 1616, 420);
  await render("social.html", "social@2x.png", 1280, 640);
  await render("diagram-memory.html", "diagram-memory.png", 1060, 560);
} finally {
  await browser.close();
}
