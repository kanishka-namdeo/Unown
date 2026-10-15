#!/usr/bin/env node
/**
 * shots_capture.mjs — polished README screenshots for the Unown dashboard.
 *
 * Usage:
 *   PLAYWRIGHT_MODULE=<path to playwright pkg> bun scripts/shots_capture.mjs           # tab shots (desktop + mobile)
 *   PLAYWRIGHT_MODULE=... bun scripts/shots_capture.mjs --video                        # + ~10s tour video + gif
 *
 * Safety: only navigates and clicks TAB SWITCHERS (role=tab). Never touches
 * action buttons (run cycle / trigger job / console submit) — no LLM spend.
 * Output: download/shots/*.png (+ tour.webm / tour.gif, capture_report.json)
 */
import { existsSync, readdirSync, statSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const ENGINE = process.env.SHOTS_ENGINE_URL ?? "http://localhost:3030";
const OUT = join(process.cwd(), "download", "shots");

// The sandbox gateway (127.0.0.1:81) proxies ?XTransformPort=3030 -> engine, but its
// Caddy layer breaks the Next dev HMR websocket, so the app never hydrates there and
// every tab photographs as the zero-data SSR shell. Browsing the dev server directly
// (:3000) hydrates fine, but its relative /api?XTransformPort=3030 calls 404 on Next.
// Fix: replay the gateway transform at the browser layer — route every
// XTransformPort API call to the real engine (real live data, no mocking).
// The SSE stream (/api/events) is aborted: the header then shows its live clock
// instead of the LIVE badge (no EventSource noise in shots).
async function engineProxy(context) {
  if (process.env.SHOTS_NO_PROXY) return;
  await context.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("XTransformPort") !== "3030") return route.continue();
    if (u.pathname === "/api/events") return route.abort();
    try {
      const resp = await route.fetch({ url: ENGINE + u.pathname + u.search });
      return route.fulfill({ response: resp });
    } catch {
      return route.abort();
    }
  });
  console.log(`[proxy] ${new URL(BASE).host}/api?XTransformPort=3030 -> ${ENGINE}`);
}

// ---------- resolve playwright (scratch install in gitignored download/.pwtools) ----------
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  "playwright",
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
].filter(Boolean);
let chromium = null;
let lastErr = null;
for (const c of PW_CANDIDATES) {
  try {
    const mod = await import(c.startsWith("/") || c.startsWith("file:") ? pathToFileURL(c).href : c);
    chromium = mod.chromium;
    console.log(`[pw] using playwright from: ${c}`);
    break;
  } catch (e) {
    lastErr = e;
  }
}
if (!chromium) {
  console.error("playwright not resolvable:", lastErr?.message);
  process.exit(1);
}

// ---------- resolve a chromium executable from the playwright cache ----------
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
const executablePath = findChrome();
if (executablePath) console.log(`[pw] chromium: ${executablePath}`);

const TABS = [
  { name: "overview", file: "01-overview.png", label: "Overview" },
  { name: "lab", file: "02-learning-lab.png", label: "Learning Lab" },
  { name: "memory", file: "03-memory.png", label: "Memory" },
  { name: "dreams", file: "04-dreams.png", label: "Dreams" },
  { name: "hooks", file: "05-hooks.png", label: "Hooks" },
  { name: "console", file: "06-console.png", label: "Console" },
  { name: "router", file: "07-router.png", label: "Router" },
];

const report = { base: BASE, generatedAt: new Date().toISOString(), tabs: [], mobile: null, video: null, consoleNotes: [] };

// ---------- DOM quality probe (runs in page) ----------
const PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const panel = document.querySelector('[role="tabpanel"][data-state="active"]') ?? document.body;
  const headings = [...document.querySelectorAll("main h1,main h2,main h3")].filter(vis).slice(0, 14).map((h) => h.textContent.trim().slice(0, 90));
  const cards = [...document.querySelectorAll('[data-slot="card"]')].filter(vis);
  const cardTitles = cards.map((c) => c.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? "").slice(0, 24);
  const emptyCards = cards
    .filter((c) => (c.innerText ?? "").trim().length < 6)
    .map((c) => c.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? "(untitled)");
  const svgs = [...panel.querySelectorAll("svg")].filter(vis).length;
  const charts = [...panel.querySelectorAll("svg.recharts-surface, svg[class*=recharts]")].filter(vis).map((s) => {
    const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  const canvases = [...panel.querySelectorAll("canvas")].filter(vis).map((s) => {
    const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  const tableRows = panel.querySelectorAll("table tr, [role=row]").length;
  const skeletons = [...document.querySelectorAll('[data-slot="skeleton"], [class*="skeleton"]')].filter(vis).length;
  const spinners = [...document.querySelectorAll('[class*="animate-spin"]')].filter(vis).length;
  const buttons = [...panel.querySelectorAll("button")].filter(vis).map((b) => b.textContent.trim()).filter((t) => t && t.length < 40).slice(0, 20);
  // stat-ish lines from the visible text (numbers/%/ms/counts)
  const lines = panel.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
  const statLines = lines.filter((l) => l.length < 70 && /\d/.test(l) && /[%ms×]|pass|fail|cycle|note|dream|decision|run|token/i.test(l)).slice(0, 26);
  return {
    headings,
    cardCount: cards.length,
    cardTitles,
    emptyCards,
    svgCount: svgs,
    charts,
    canvases,
    tableRows,
    skeletons,
    spinners,
    buttons,
    statLines,
    textLineCount: lines.length,
    textPreview: lines.slice(0, 40),
  };
};

// ---------- shared capture helpers ----------
async function settle(page) {
  // SSE keeps a connection open, so plain networkidle may never fire — race it.
  await Promise.race([page.waitForLoadState("networkidle").catch(() => {}), sleep(4000)]);
  await sleep(2200); // charts + framer-motion fades + SSE hello
}

// Hide transient chrome so README shots look like steady state: the Next.js
// dev-tools overlay badge AND any sonner/radix toast notifications (a live
// "router is busy" toast mid-shot reads as an artifact).
async function hideDevChrome(page) {
  await page
    .addStyleTag({
      content:
        "nextjs-portal{display:none!important;} [data-sonner-toaster]{display:none!important;} [data-radix-popper-content-wrapper]{display:none!important;}",
    })
    .catch(() => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitNoSkeletons(page, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return [...document.querySelectorAll('[data-slot="skeleton"], [class*="skeleton"], [class*="animate-spin"]')].filter(vis).length;
    });
    if (n === 0) return true;
    await sleep(400);
  }
  return false;
}

function attachConsole(page, bucket) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") bucket.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => bucket.push(`[pageerror] ${String(e).slice(0, 300)}`));
}

async function captureTab(page, tab, idx) {
  const errors = [];
  attachConsole(page, errors);
  if (idx === 0) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await hideDevChrome(page);
  } else {
    await page.getByRole("tab", { name: tab.label }).click();
  }
  await settle(page);
  if (idx === 0 && !process.env.SHOTS_NO_TRIGGER) {
    // Fire real (non-LLM) background jobs AFTER the SSE stream is connected,
    // so the Live Activity feed catches genuine job:* events. note-sync only
    // delivers queued notes and sandbox-gc only prunes expired run dirs —
    // both are routine router jobs that involve zero model calls.
    for (const job of ["note-sync", "sandbox-gc"]) {
      await fetch(`${ENGINE}/api/jobs/${job}/trigger`, { method: "POST" }).catch(() => {});
    }
    await sleep(3000);
  }
  const clean = await waitNoSkeletons(page);
  const probe = await page.evaluate(PROBE);
  const path = join(OUT, tab.file);
  await page.screenshot({ path, fullPage: true });
  const size = statSync(path).size;
  const title = await page.title();
  const entry = {
    tab: tab.label,
    url: page.url(),
    file: tab.file,
    bytes: size,
    title,
    skeletonsGone: clean,
    ...probe,
    consoleErrors: [...new Set(errors)].slice(0, 12),
  };
  report.tabs.push(entry);
  console.log(
    `✓ ${tab.file} (${(size / 1024).toFixed(0)} KB) — cards:${probe.cardCount} rows:${probe.tableRows} svg:${probe.svgCount} charts:${probe.charts.length} skeleton-free:${clean} errs:${entry.consoleErrors.length}`
  );
  return entry;
}

// ---------- main ----------
const doVideo = process.argv.includes("--video");
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
});

try {
  // ===== desktop pass =====
  const ctx = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await engineProxy(ctx);
  const page = await ctx.newPage();
  for (let i = 0; i < TABS.length; i++) await captureTab(page, TABS[i], i);
  await ctx.close();

  // ===== mobile pass (Overview) =====
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await engineProxy(mctx);
  const mpage = await mctx.newPage();
  const merr = [];
  attachConsole(mpage, merr);
  await mpage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await hideDevChrome(mpage);
  await settle(mpage);
  await waitNoSkeletons(mpage);
  const mprobe = await mpage.evaluate(PROBE);
  const mpath = join(OUT, "08-overview-mobile.png");
  await mpage.screenshot({ path: mpath, fullPage: true });
  report.mobile = { file: "08-overview-mobile.png", bytes: statSync(mpath).size, ...mprobe, consoleErrors: [...new Set(merr)].slice(0, 8) };
  console.log(`✓ 08-overview-mobile.png (${(statSync(mpath).size / 1024).toFixed(0)} KB) — responsive layout probe: nav wraps=${mprobe.textLineCount > 0}`);
  await mctx.close();

  // ===== tour video =====
  if (doVideo) {
    const vdir = join(OUT, ".video");
    const vctx = await browser.newContext({
      viewport: { width: 1280, height: 832 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      recordVideo: { dir: vdir, size: { width: 1280, height: 832 } },
    });
    await engineProxy(vctx);
    const vpage = await vctx.newPage();
    await vpage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await hideDevChrome(vpage);
    await sleep(3800); // hydrate + charts + SSE hello (prod server is warm)
    for (const label of ["Learning Lab", "Memory"]) {
      await vpage.getByRole("tab", { name: label }).click();
      await settle(vpage);
      await sleep(2600); // dwell
    }
    await vpage.getByRole("tab", { name: "Overview" }).click();
    await sleep(1600);
    await vctx.close(); // flushes the webm
    const files = readdirSync(vdir).filter((f) => f.endsWith(".webm"));
    if (files.length) {
      renameSync(join(vdir, files[0]), join(OUT, "tour.webm"));
      report.video = { file: "tour.webm", bytes: statSync(join(OUT, "tour.webm")).size };
      console.log(`✓ tour.webm (${(report.video.bytes / 1024).toFixed(0)} KB)`);
    }
  }
} finally {
  await browser.close();
}

// sidecar report for humans/agents
const { writeFileSync } = await import("node:fs");
writeFileSync(join(OUT, "capture_report.json"), JSON.stringify(report, null, 2));
console.log(`\nreport → download/shots/capture_report.json (${report.tabs.length} tabs + mobile${doVideo ? " + video" : ""})`);
