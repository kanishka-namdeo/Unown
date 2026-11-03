#!/usr/bin/env bun
/**
 * Coda PWA benchmark — installability inventory + offline/online boot timing.
 *
 * Ticket T2 (doc-truth round): flips the PT-5 plan's honest "not measured"
 * PWA null with a real receipted measurement. Measures the REAL app
 * (apps/coda/) served by its own transpiling dev server
 * (apps/coda/scripts/serve.mjs, bun-only), driven by Playwright chromium —
 * the same lane the e2e specs run on.
 *
 * Two measurements:
 *   (a) INSTALLABILITY — the criteria the e2e lane asserts (manifest fetch,
 *       required fields, icon inventory, SW registered + controlling,
 *       display mode), recorded as data: pass/fail + inventory JSON.
 *   (b) TIMING — online baseline (N fresh-context boots) vs offline
 *       (SW-controled, setOffline(true) + reload, N runs): navigation-start
 *       to the app's real ready marker (#coda-status == "Ready."), median
 *       + min/max per phase.
 *
 * Honesty rules (benchmarks/ house contract): no model traffic, no
 * endpoint spend; headless chromium in a container, stated in the receipt;
 * a figure is a measured median over N, never a guess.
 *
 * Run (from the repo root):
 *   bun benchmarks/coda-pwa/run-pwa-bench.mjs [--runs 5] [--port 4099]
 *
 * Receipts: receipts/run-<ts>/{installability.json,timing-online.json,
 * timing-offline.json,summary.json} — committed; scratch logs never
 * committed. Exit 0 = all hard checks pass; 1 = a hard criterion failed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { chromium } from "@playwright/test";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const LANE_DIR = import.meta.dirname;

// ---- args ----
const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const RUNS = Number(argVal("--runs") ?? 5);
const PORT = Number(argVal("--port") ?? 4099);
const BASE = `http://127.0.0.1:${PORT}`;

const now = new Date();
const ts = now.toISOString().replace(/[:.]/g, "-");
const receiptDir = resolve(LANE_DIR, "receipts", `run-${ts}`);
mkdirSync(receiptDir, { recursive: true });

const receipt = {
  lane: "coda-pwa",
  receipt: `benchmarks/coda-pwa/receipts/run-${ts}`,
  generatedAt: now.toISOString(),
  environment: {
    server: "bun apps/coda/scripts/serve.mjs (the app's own transpiling dev server)",
    browser: "headless chromium (Playwright)",
    base: BASE,
    node: process.version,
    platform: process.platform,
    os: process.arch,
    runs: RUNS,
    caveats: [
      "Headless chromium in the operator's container — timings are machine-dependent and comparable run-to-run on the same host only.",
      "The dev server transpiles .ts on the fly (Bun.Transpiler); a production minified build would be faster — the offline/online DELTA is the signal, the absolute ms are the environment's.",
      "IndexedDB is fresh per context; no warm-start between timing runs.",
    ],
  },
  hardFails: [],
};

function fail(criterion, detail) {
  receipt.hardFails.push({ criterion, detail });
}

// ---- boot the app's own server on a scratch port ----
const server = spawn("bun", ["apps/coda/scripts/serve.mjs"], {
  cwd: REPO_ROOT,
  env: { ...process.env, CODA_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOk = false;
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/public/manifest.webmanifest`);
      if (res.status === 200) {
        serverOk = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!serverOk) throw new Error(`coda server did not come up on ${BASE}`);
} finally {
  // server lifetime managed below; kill at the very end
}

// ---- helpers ----
const READY = "Ready.";

async function waitReady(page) {
  await page.locator("#coda-status").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("#coda-status").waitForFunction(
    (el, ready) => el.textContent === ready,
    READY,
    { timeout: 15_000 },
  );
}

async function waitSwController(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
}

/** navigation-start → Ready, in ms (PerformanceNavigationTiming in-page). */
async function measureBootMs(page) {
  // wait for the ready marker; then read the perf timing of the LAST
  // navigation (reload or goto). "ready" is DOMContentLoaded+script+IDB
  // boot; wall-clock of our own wait is the honest cross-check.
  const t0 = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    if (!n) return null;
    return { domContentLoadedMs: n.domContentLoadedEventEnd, loadEventMs: n.loadEventEnd };
  });
  return t0;
}

async function timePhase(browser, mode, label) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const wall0 = performance.now();
    if (mode === "online") {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await waitReady(page);
      await waitSwController(page);
      const nav = await measureBootMs(page);
      samples.push({ run: i + 1, phase: "online", wallMs: Math.round(performance.now() - wall0), navigation: nav });
    } else {
      // offline phase boots the app ONLINE first (so the SW installs and
      // controls), then goes offline and reloads — exactly the e2e spec's
      // bootCoda() → setOffline(true) → reload sequence.
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await waitReady(page);
      await waitSwController(page);
      ctx.setOffline(true);
      const wall0o = performance.now();
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(page);
      const nav = await measureBootMs(page);
      samples.push({ run: i + 1, phase: "offline", wallMs: Math.round(performance.now() - wall0o), navigation: nav });
    }
    await ctx.close();
  }
  const meds = samples.map((s) => s.wallMs).sort((a, b) => a - b);
  const median = meds[Math.floor(meds.length / 2)];
  return {
    label,
    mode,
    n: RUNS,
    medianMs: median,
    minMs: meds[0],
    maxMs: meds[meds.length - 1],
    samples,
    method:
      mode === "online"
        ? "fresh context → goto / → wait #coda-status 'Ready.' → wait SW controller; wall-clock from navigation trigger to Ready"
        : "fresh context → goto / online (SW install + claim) → context.setOffline(true) → reload → wait 'Ready.'; wall-clock from reload trigger to Ready",
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- (a) installability inventory ----
async function measureInstallability(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const inv = { pass: true, checks: {} };

  // 1. manifest fetch + required fields
  const manifestRes = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).then(() =>
    page.request.get(`${BASE}/public/manifest.webmanifest`),
  );
  const manifestStatus = manifestRes.status();
  inv.checks.manifestFetch = { status: manifestStatus, ok: manifestStatus === 200 };
  if (manifestStatus !== 200) {
    inv.pass = false;
    fail("manifest fetch", `GET /public/manifest.webmanifest → ${manifestStatus}`);
  }

  let manifest = null;
  if (manifestStatus === 200) {
    manifest = await manifestRes.json();
    const required = ["name", "icons", "start_url", "display"];
    const missing = required.filter((k) => manifest[k] == null || manifest[k] === "");
    inv.checks.requiredFields = { fields: required, missing, ok: missing.length === 0 };
    if (missing.length) {
      inv.pass = false;
      fail("manifest required fields", `missing: ${missing.join(", ")}`);
    }
    inv.checks.display = manifest.display;
    inv.checks.startUrl = manifest.start_url;
    inv.checks.scope = manifest.scope ?? null;
  }

  // 2. icon inventory (sizes present + each icon actually fetches)
  const iconInventory = [];
  for (const icon of manifest?.icons ?? []) {
    const res = await page.request.get(new URL(icon.src, `${BASE}/public/`).href);
    iconInventory.push({ src: icon.src, sizes: icon.sizes, type: icon.type, purpose: icon.purpose, fetchStatus: res.status() });
  }
  inv.iconInventory = iconInventory;
  inv.checks.icons = {
    count: iconInventory.length,
    sizes: iconInventory.map((i) => i.sizes),
    allFetched: iconInventory.every((i) => i.fetchStatus === 200),
  };
  if (!inv.checks.icons.allFetched) {
    inv.pass = false;
    fail("icon inventory", `non-200 icon fetches: ${iconInventory.filter((i) => i.fetchStatus !== 200).map((i) => i.src).join(", ")}`);
  }

  // 3. SW registered + controlling (the e2e lane's own criterion)
  const swController = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? { scope: r.scope, url: r.active?.scriptURL ?? null } : null;
  });
  inv.checks.serviceWorker = { controllerActive: swController, registration: reg };
  if (!swController || !reg) {
    inv.pass = false;
    fail("service worker controlling", `controller=${swController} registration=${JSON.stringify(reg)}`);
  }

  // 4. beforeinstallprompt — soft-gated (headless unreliability, plan pitfall):
  //    RECORDED, never a hard fail.
  const installPromptFired = await page
    .waitForEvent("beforeinstallprompt", { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  inv.checks.beforeinstallprompt = { observed: installPromptFired, note: "record-only; soft-gated per the plan's P1 pitfall (headless chromium)" };

  await ctx.close();
  return inv;
}

// ---- main ----
let browser;
let exitCode = 0;
try {
  browser = await chromium.launch();

  receipt.installability = await measureInstallability(browser);
  if (!receipt.installability.pass) exitCode = 1;

  receipt.timing = {
    online: await timePhase(browser, "online", "online baseline boot (fresh context)"),
    offline: await timePhase(browser, "offline", "offline boot-from-cache (SW-controlled, setOffline + reload)"),
  };
  receipt.timing.deltaMs = receipt.timing.offline.medianMs - receipt.timing.online.medianMs;
} finally {
  if (browser) await browser.close();
  server.kill();
}

receipt.verdict = exitCode === 0 ? "PASS" : "FAIL";

// ---- write receipts (incremental house rule: one file per part) ----
writeFileSync(resolve(receiptDir, "installability.json"), JSON.stringify(receipt.installability, null, 2));
writeFileSync(resolve(receiptDir, "timing-online.json"), JSON.stringify(receipt.timing, null, 2));
writeFileSync(resolve(receiptDir, "summary.json"), JSON.stringify(receipt, null, 2));

// ---- console summary ----
const inv = receipt.installability;
console.log(`[coda-pwa] installability: ${inv.pass ? "PASS" : "FAIL"}`);
console.log(`[coda-pwa]   manifest fetch ${inv.checks.manifestFetch.status}, required fields ${inv.checks.requiredFields.missing.length === 0 ? "all present" : "MISSING: " + inv.checks.requiredFields.missing}`, `display=${inv.checks.display}`, `icons=${inv.checks.icons.count} (${inv.checks.icons.sizes.join(", ")})`);
console.log(`[coda-pwa]   SW controller=${inv.checks.serviceWorker.controllerActive} scope=${inv.checks.serviceWorker.registration?.scope}`);
console.log(`[coda-pwa]   beforeinstallprompt observed=${inv.checks.beforeinstallprompt.observed} (record-only)`);
const on = receipt.timing.online;
const off = receipt.timing.offline;
console.log(`[coda-pwa] online boot: median ${on.medianMs} ms (min ${on.minMs} / max ${on.maxMs}, N=${on.n})`);
console.log(`[coda-pwa] offline boot-from-cache: median ${off.medianMs} ms (min ${off.minMs} / max ${off.maxMs}, N=${off.n})`);
console.log(`[coda-pwa] delta offline−online: ${receipt.timing.deltaMs} ms median`);
console.log(`[coda-pwa] receipt: ${receipt.receipt}`);
console.log(`[coda-pwa] verdict: ${receipt.verdict}`);

process.exit(exitCode);
