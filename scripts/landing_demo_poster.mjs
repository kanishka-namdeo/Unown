#!/usr/bin/env node
/**
 * landing_demo_poster.mjs — capture the live-demo band's poster stills.
 *
 * The posters are the lazy-mount placeholders for the live-demo iframes on
 * the landing page (real screenshots of the routes they frame, not
 * marketing mocks). This lane exists so the assets are reproducible: it
 * boots nothing itself — it shoots the routes from a server you point it
 * at. The commerce round (2026-10-28) turned the band into a gallery: one
 * poster per app, both shot in one pass.
 *
 *   bun scripts/landing_demo_poster.mjs [--url http://127.0.0.1:3000]
 *
 * The --url flag overrides the FIRST route's base (default localhost:3000);
 * every app's route is appended with ?embed=1. Output: one PNG per app
 * at the path each app's data entry declares (public/<poster path>),
 * 1440x900 viewport, scale 2. Each
 * route seeds its demo data on first load, so every poster shows what a
 * first-time visitor sees.
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The apps the band frames — the single source of truth is the landing's
// data file; importing it here keeps a new app's poster automatic.
const { LIVE_DEMO_APPS } = await import(
  ROOT + "/src/components/landing/live-demo-data.ts"
);

const baseOverride = process.argv.find((a, i) => process.argv[i - 1] === "--url");
const BASE = (baseOverride ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

// The sandbox's Playwright cache holds the full chromium build (the
// package's default headless-shell revision may not be present); pin the
// executable when the default is missing so the lane runs on both.
const FALLBACK_EXECUTABLE = `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`;
const launchOptions = existsSync(FALLBACK_EXECUTABLE)
  ? { executablePath: FALLBACK_EXECUTABLE }
  : {};

const browser = await chromium.launch(launchOptions);
const failures = [];
for (const app of LIVE_DEMO_APPS) {
  const url = `${BASE}${app.route}?embed=1`;
  // The output path mirrors the DATA file's declared poster path (focus's
  // poster lives at /landing/demo/poster.png — its id predates the path;
  // never move committed media assets).
  const out = resolve(ROOT, `public${app.poster}`);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // let the demo seed land + charts paint
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    if (errors.length) throw new Error(`console errors: ${errors.join("; ")}`);
    console.log("wrote", out, "from", url);
  } catch (e) {
    failures.push(`${app.id}: ${e}`);
  } finally {
    await page.close();
  }
}
await browser.close();

if (failures.length) {
  console.error("poster capture failures:", failures);
  process.exit(1);
}
