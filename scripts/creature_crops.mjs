#!/usr/bin/env node
/**
 * creature_crops.mjs — element-level crops of the creature placements, for
 * focused design review (a full-band screenshot is too wide for a reviewer
 * to actually see a 64px sprite: the contact-sheet and hero-fit reviews kept
 * describing the seal glyphs instead).
 *
 * The placements retired 2026-10-20 when the capability dex became the one
 * canonical home for the creatures: the crops now frame the dex itself —
 * the list (numbered rows + search) and the visible detail pane (specimen,
 * entry, practice/weakness/receipt rows), in both schemes.
 *
 * Usage: node scripts/creature_crops.mjs
 * Env:   LANDING_SHOTS_URL (default http://localhost:3111)
 * Out:   download/creatures/crop-{dark,light}-{list,detail}.png (gitignored)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.LANDING_SHOTS_URL ?? "http://localhost:3111";
const OUT = join(process.cwd(), "download/creatures");
mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import(
    join(process.cwd(), "download/.pwtools/node_modules/playwright/index.mjs")
  ));
} catch {
  ({ chromium } = await import("playwright"));
}

const browser = await chromium.launch();
for (const scheme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1512, height: 900 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const list = page.locator("#dex [role='listbox']").first();
  await list.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await list.screenshot({ path: join(OUT, `crop-${scheme}-list.png`) });

  const detail = page.locator("#dex article:not([hidden])").first();
  await detail.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await detail.screenshot({ path: join(OUT, `crop-${scheme}-detail.png`) });

  await ctx.close();
}
await browser.close();
console.log(`crops → ${OUT}/crop-{dark,light}-{list,detail}.png`);
