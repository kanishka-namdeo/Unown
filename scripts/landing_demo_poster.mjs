#!/usr/bin/env node
/**
 * landing_demo_poster.mjs — capture the live-demo section's poster still.
 *
 * The poster is the lazy-mount placeholder for the live-demo iframe on the
 * landing page (a real screenshot of the /demo route it frames, not a
 * marketing mock). This lane exists so the asset is reproducible: it boots
 * nothing itself — it shoots the route from a server you point it at.
 *
 *   node scripts/landing_demo_poster.mjs [--url http://127.0.0.1:3000/demo?embed=1]
 *
 * Output: public/landing/demo/poster.png (1440x900 viewport, device scale 2).
 * The demo route seeds its board on first load, so the poster shows the
 * seeded board a first-time visitor sees.
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/landing/demo/poster.png");

// The sandbox's Playwright cache holds the full chromium build (the
// package's default headless-shell revision may not be present); pin the
// executable when the default is missing so the lane runs on both.
const FALLBACK_EXECUTABLE = `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`;
const launchOptions = existsSync(FALLBACK_EXECUTABLE)
  ? { executablePath: FALLBACK_EXECUTABLE }
  : {};

const url =
  process.argv.find((a, i) => process.argv[i - 1] === "--url") ||
  "http://127.0.0.1:3000/demo?embed=1";

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200); // let the demo seed land + charts paint
mkdirSync(dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT });
await browser.close();

if (errors.length) {
  console.error("console errors while shooting (poster still saved):", errors);
  process.exit(1);
}
console.log("wrote", OUT);
