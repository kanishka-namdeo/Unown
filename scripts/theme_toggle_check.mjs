#!/usr/bin/env node
/**
 * theme_toggle_check.mjs — the theme TOGGLE's own gate.
 *
 * `contrast_audit.mjs` proves the palette holds AA in both schemes, but it
 * drives them through `prefers-color-scheme`, which is only HALF the theming
 * contract. The nav toggle writes an explicit `[data-theme]` override on
 * `<html>`, and the inline bootstrap in `layout.tsx` replays the persisted
 * choice from localStorage before first paint. Neither of those is reached by
 * an emulated colour scheme, so a regression there — an attribute that no
 * longer wins the cascade, a bootstrap that stops replaying — would pass the
 * contrast audit and still ship a broken switch.
 *
 * This drives the real control: it clicks through auto -> light -> dark ->
 * auto, asserts `--color-canvas` resolves to the hex each state should
 * produce, that the attribute and localStorage agree, that the choice
 * survives a reload (the bootstrap's job), and that the button's accessible
 * name announces the current state.
 *
 * Usage:
 *   LANDING_SHOTS_URL=http://localhost:3111 bun scripts/theme_toggle_check.mjs
 *
 * Output: printed PASS/FAIL table. Exits non-zero on any failure.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.LANDING_SHOTS_URL ?? "http://localhost:3111";

/* ---------- resolve playwright (scratch install first) ---------- */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);

let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    const href = /^[a-z]+:/i.test(c) ? c : pathToFileURL(c).href;
    const mod = await import(href);
    chromium = mod.chromium;
    break;
  } catch {
    /* try the next candidate */
  }
}
if (!chromium) {
  console.error("playwright not resolvable — run `bun add playwright` in download/.pwtools/");
  process.exit(1);
}

/** Locate the cached chromium; playwright's own default is tried first. */
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
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

/** Compare a resolved custom property to an expected hex, tolerating #/3-digit forms. */
const hexOf = (v) => {
  const s = (v ?? "").trim().replace(/^#/, "").toLowerCase();
  return s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
};

try {
  // OS is emulated dark, so the "auto" state must resolve to the dark screen.
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1000);

  const state = async () =>
    page.evaluate(() => ({
      attr: document.documentElement.dataset.theme ?? null,
      canvas: getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim(),
      ls: localStorage.getItem("unown-theme"),
    }));

  const expect = async (label, wantAttr, wantCanvas) => {
    const s = await state();
    const okAttr = s.attr === wantAttr;
    const okCanvas = hexOf(s.canvas) === hexOf(wantCanvas);
    const okLs = wantAttr === null ? s.ls === null : s.ls === wantAttr;
    const ok = okAttr && okCanvas && okLs;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(26)} attr=${String(s.attr).padEnd(5)} ` +
        `canvas=${s.canvas.padEnd(8)} ls=${String(s.ls).padEnd(5)} (want attr=${wantAttr}, canvas=${wantCanvas})`,
    );
  };

  const btn = page.locator('button[aria-label^="Screen:"]');
  console.log(`theme toggle cycle on ${BASE} (OS emulated dark, so auto == dark):`);
  await expect("initial auto", null, "#102039");
  await btn.click(); await sleep(200);
  await expect("cycle 1 -> light", "light", "#e6e6d5");
  await btn.click(); await sleep(200);
  await expect("cycle 2 -> dark", "dark", "#102039");
  await btn.click(); await sleep(200);
  await expect("cycle 3 -> auto", null, "#102039");

  // The inline <head> bootstrap must replay a persisted choice after reload.
  await btn.click(); await sleep(200);
  await expect("set light", "light", "#e6e6d5");
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(600);
  await expect("persisted after reload", "light", "#e6e6d5");

  // The control must announce its state to a screen reader.
  const label = await btn.getAttribute("aria-label");
  const labelOk = /Screen: Daylight/.test(label);
  if (!labelOk) failures++;
  console.log(`  ${labelOk ? "PASS" : "FAIL"}  aria-label announces state   "${label}"`);

  await ctx.close();
} finally {
  await browser.close();
}

if (failures) {
  console.log(`\nFAIL  ${failures} theme-toggle assertion(s) on ${BASE}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS  theme toggle on ${BASE} (data-theme override, persistence, a11y label)`);
}
