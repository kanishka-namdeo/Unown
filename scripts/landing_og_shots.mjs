#!/usr/bin/env node
/**
 * landing_og_shots.mjs — regenerate the tracked marketing screenshots in
 * `public/landing/`, which are the OpenGraph images `layout.tsx` points at.
 *
 * This was an ad-hoc script in gitignored `download/` while the assets it
 * writes were tracked — so the OG image of the landing page had no generator
 * anyone could run from a clean checkout. It lives here now, and it asserts the
 * palette before shooting, because a screenshot of the OLD build looks exactly
 * like a screenshot of the new one to nobody but the person who has to notice.
 *
 * Needs the PRODUCTION build on the base URL (that is what Vercel serves):
 *   bun run build
 *   PORT=3111 NODE_ENV=production bun .next/standalone/server.js &
 *   bun scripts/landing_og_shots.mjs
 *
 * Override the base with LANDING_SHOTS_URL. Exits non-zero on a console error
 * or on a scheme that did not apply.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.LANDING_SHOTS_URL ?? "http://localhost:3111";
const OUT = join(process.cwd(), "public", "landing");

/** The dark scheme's canvas, as declared in `src/app/globals.css`. */
const EXPECT_CANVAS = "#102039";

const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);

let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    const mod = await import(/^[a-z]+:/i.test(c) ? c : pathToFileURL(c).href);
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
  const subs = ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"];
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
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--hide-scrollbars"],
});

mkdirSync(OUT, { recursive: true });
let bad = 0;

async function shoot(width, height, file, fullPage) {
  // Dark is the default scheme and the one these images have always shown.
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Scroll the document so every CSS scroll-reveal settles to its FINISHED
  // state; a half-revealed OG image looks like a broken page in a chat preview.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 900));

  const canvas = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim(),
  );
  const hex = (v) => (v ?? "").trim().replace(/^#/, "").toLowerCase();
  if (hex(canvas) !== hex(EXPECT_CANVAS)) {
    console.error(`  ${file}: --color-canvas is ${canvas || "(unset)"}, expected ${EXPECT_CANVAS}. Is the server running the CURRENT build?`);
    bad++;
    await ctx.close();
    return;
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  await page.screenshot({ path: join(OUT, file), fullPage });
  const warn = overflow.scrollWidth > overflow.innerWidth ? "  <-- HORIZONTAL OVERFLOW" : "";
  console.log(`  ${file}  ${width}x${height}${fullPage ? " fullPage" : ""}  canvas=${canvas}${warn}`);
  if (errors.length) {
    console.error(`  ${file}: ${errors.length} console error(s): ${errors.slice(0, 3).join(" | ")}`);
    bad++;
  }
  await ctx.close();
}

console.log(`landing_og_shots -> ${OUT} (base ${BASE})`);
await shoot(1512, 900, "landing-hero.png", false);
await shoot(1512, 900, "landing-full.png", true);
await shoot(375, 812, "landing-mobile.png", false);
await browser.close();

if (bad) {
  console.error(`\nFAIL  ${bad} shot(s) rejected`);
  process.exitCode = 1;
} else {
  console.log("\nPASS  three OG images regenerated against the shipped palette");
}
