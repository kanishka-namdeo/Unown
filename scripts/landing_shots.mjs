#!/usr/bin/env node
/**
 * landing_shots.mjs — the landing page's visual verification pass.
 *
 * The landing AGENTS.md makes a visual check against the PRODUCTION build
 * mandatory ("required, not optional"), and this is how it is run. It browses
 * the built page, screenshots every top-level section once — in BOTH colour
 * schemes, because the page ships a dark screen (the emissive DMG, the @theme
 * default) and a light screen (the same LCD unlit in daylight, applied via
 * `prefers-color-scheme`) — and then repeats the pass under
 * `prefers-reduced-motion: reduce` so a reveal that fails to resolve to its
 * finished state shows up as a blank frame rather than as an opinion.
 *
 * Each scheme pass first asserts that `--color-canvas` resolved to the hex
 * that scheme should produce, so a cascade bug cannot silently photograph the
 * dark palette twice and call the light one "covered".
 *
 * Usage:
 *   bun scripts/landing_shots.mjs                 # http://localhost:3111/
 *   LANDING_SHOTS_URL=http://localhost:3000 bun scripts/landing_shots.mjs
 *   bun scripts/landing_shots.mjs --mobile        # + the 390px pass
 *
 * It reads the playwright scratch install in `download/.pwtools/` (same
 * install `shots_capture.mjs` uses) and falls back to a resolvable
 * `playwright` package. Requires a chromium build in the playwright cache.
 *
 * Output: download/landing/*.png + landing_report.json (gitignored). Light
 * shots are prefixed `light-`; dark keeps the unprefixed historical names.
 * Never clicks anything that spends money; it only scrolls and screenshots.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.LANDING_SHOTS_URL ?? "http://localhost:3111";
const OUT = join(process.cwd(), "download", "landing");
const DO_MOBILE = process.argv.includes("--mobile");

/* ---------- resolve playwright (scratch install first) ---------- */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);

let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    // An absolute path becomes a file: URL; a bare specifier must stay bare,
    // because pathToFileURL turns "playwright" into file:///playwright and the
    // documented fallback to the installed package could never resolve.
    const absolute = c.startsWith("/") || /^[A-Za-z]:[\\/]/.test(c);
    const href = /^[a-z]+:/i.test(c) || !absolute ? c : pathToFileURL(c).href;
    const mod = await import(href);
    chromium = mod.chromium;
    console.log(`[pw] using playwright from: ${c}`);
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
const executablePath = findChrome();
console.log(`[pw] chromium: ${executablePath ?? "(playwright default)"}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(text, fallback) {
  const s = (text || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 46);
  return s || fallback;
}

/**
 * The shot plan is derived from the DOM rather than hard-coded: a section
 * that gets added or renamed is photographed automatically, which is the
 * difference between a check that keeps up and one that quietly stops
 * covering half the page.
 */
const PLAN = () => {
  const main = document.querySelector("main");
  if (!main) return [];
  return [...main.children].map((el, i) => {
    const h = el.querySelector("h1, h2");
    return { index: i, label: (h?.textContent ?? "").trim().slice(0, 60) };
  });
};

async function shootSection(page, entry, idx, prefix = "") {
  const name = `${prefix}${String(idx + 1).padStart(2, "0")}-${slug(entry.label, `block-${entry.index}`)}`;
  await page.evaluate((i) => {
    const el = document.querySelector("main")?.children[i];
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "instant" });
  }, entry.index);
  await sleep(700); // let the view-timeline reveals settle
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  return { file, label: entry.label, bytes: statSync(join(OUT, file)).size };
}

async function openPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 240)}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1800);
  return { ctx, page, errors };
}

/**
 * Both schemes the page ships, and the `--color-canvas` each must resolve to.
 * The section pass loops these. The assertion matters: the light scheme is
 * applied by a `prefers-color-scheme` media query, so if that block ever loses
 * the cascade a light pass would photograph the dark palette and a green run
 * would mean nothing. We compare resolved-vs-expected and hard-fail instead.
 */
const SCHEMES = [
  { scheme: "dark", canvas: "#102039", prefix: "" },
  { scheme: "light", canvas: "#e6e6d5", prefix: "light-" },
];

async function assertScheme(page, expectedCanvas, scheme) {
  const got = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim(),
  );
  const norm = (v) => {
    const s = (v ?? "").replace(/^#/, "").toLowerCase();
    return s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  };
  if (norm(got) !== norm(expectedCanvas)) {
    throw new Error(
      `scheme "${scheme}" did not apply: --color-canvas=${got || "(unset)"} (expected ${expectedCanvas}). ` +
        `Not photographing a palette that is not on screen.`,
    );
  }
  return got;
}

mkdirSync(OUT, { recursive: true });
const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  shots: [],
  reducedMotion: [],
  mobile: [],
  consoleErrors: [],
};

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
});

try {
  /* ---- 1. every section, motion on, in BOTH schemes ---- */
  const plan = await (async () => {
    const probe = await openPage(browser);
    const p = await probe.page.evaluate(PLAN);
    await probe.ctx.close();
    return p;
  })();
  console.log(`[plan] ${plan.length} top-level blocks on ${BASE}`);

  for (const { scheme, canvas, prefix } of SCHEMES) {
    const pass = await openPage(browser, { colorScheme: scheme });
    const applied = await assertScheme(pass.page, canvas, scheme);
    console.log(`[scheme] "${scheme}" — --color-canvas resolved to ${applied}`);
    for (let i = 0; i < plan.length; i++) {
      const s = await shootSection(pass.page, plan[i], i, prefix);
      report.shots.push({ ...s, scheme });
      console.log(`  + ${s.file}  "${s.label}"  [${scheme}]`);
    }
    if (scheme === "dark") report.consoleErrors = [...new Set(pass.errors)];
    else report.consoleErrors.push(...pass.errors);
    await pass.ctx.close();
  }
  report.consoleErrors = [...new Set(report.consoleErrors)].slice(0, 12);

  /* ---- 2. reduced motion: reveals must resolve to their finished state ---- */
  const rm = await openPage(browser, { reducedMotion: "reduce" });
  const picks = [...new Set([0, Math.floor(plan.length / 2), plan.length - 1])];
  for (const i of picks) {
    const s = await shootSection(rm.page, plan[i], i, "reduced-");
    report.reducedMotion.push(s);
    console.log(`  + ${s.file} (reduced motion)`);
  }
  await rm.ctx.close();

  /* ---- 3. mobile, optional ---- */
  if (DO_MOBILE) {
    const m = await openPage(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mplan = await m.page.evaluate(PLAN);
    for (const i of [...new Set([0, 2, mplan.length - 1])]) {
      const s = await shootSection(m.page, mplan[i], i, "mobile-");
      report.mobile.push(s);
      console.log(`  + ${s.file} (390px)`);
    }
    await m.ctx.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT, "landing_report.json"), JSON.stringify(report, null, 2));
console.log(
  `\nreport -> download/landing/landing_report.json (${report.shots.length} sections, ${report.reducedMotion.length} reduced-motion${report.mobile.length ? `, ${report.mobile.length} mobile` : ""})`
);
if (report.consoleErrors.length) {
  console.log("console errors:");
  report.consoleErrors.forEach((e) => console.log(`  ! ${e}`));
  process.exitCode = 1;
}
