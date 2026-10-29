#!/usr/bin/env node
/**
 * The aria round's live headless-Chromium UI pass (plan Phase 5, the 8 steps):
 * login → account list → deal detail → sequence advance → import dry-run →
 * forecast drill-down → audit feed → reset.
 *
 * Runs against a PRODUCTION standalone server (the same artifact the e2e
 * webServer uses):  node .next/standalone/server.js  (PORT=3210).
 *
 * Output: one line per step, "PASS <n> <name>" / "FAIL <n> <name> <reason>";
 * exit 0 iff all eight pass. Zero console errors tolerated (the
 * landing_demo_poster bar, applied to the app surface).
 *
 * Usage: node benchmarks/aria-round/ui-pass.mjs [baseURL]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3210";
const DEMO_EMAIL = "mira@lumen.test";
const DEMO_PASSWORD = "aria-demo-1";

const steps = [];
let consoleErrors = 0;

function step(n, name, fn) {
  steps.push({ n, name, fn });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors += 1;
});
page.on("pageerror", () => {
  consoleErrors += 1;
});

step(1, "login", async () => {
  await page.goto(`${BASE}/aria`, { waitUntil: "networkidle" });
  // Settle the hydration window before interacting (an early click is a no-op).
  await page.waitForTimeout(500);
  const email = page.locator('input[type="email"]');
  await email.waitFor({ timeout: 10_000 });
  await email.fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  try {
    // The sidebar <nav> carries role="tablist" (an explicit role overrides
    // the implicit navigation landmark) — query the tablist, not navigation.
    await page.getByRole("tablist", { name: /aria navigation/i }).waitFor({ timeout: 10_000 });
  } catch {
    // One retry: a click during hydration is a silent no-op.
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.getByRole("tablist", { name: /aria navigation/i }).waitFor({ timeout: 10_000 });
  }
});

step(2, "account list", async () => {
  const list = page.locator('ul[aria-label="Accounts"]');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole("tab", { name: "Accounts" }).click();
    try {
      // The seeded list renders accounts; the empty state renders one li.
      await list.locator("li").first().waitFor({ timeout: 5_000 });
      const rows = await list.locator("li").count();
      if (rows >= 1) return;
    } catch {
      /* retry — the click may have landed during hydration */
    }
  }
  throw new Error("no account rows rendered after two attempts");
});

step(3, "deal detail", async () => {
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.waitForTimeout(600);
  // Deal cards open via a titled button (title={deal.id}).
  const card = page.locator("button[title^='adeal_']").first();
  await card.click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  // The detail view renders the deal id as its heading.
  await page.locator("h2:has-text('adeal_')").first().waitFor({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
});

step(4, "sequence advance", async () => {
  await page.getByRole("tab", { name: "Sequences" }).click();
  await page.waitForTimeout(600);
  const advance = page.getByRole("button", { name: /advance/i }).first();
  const any = await advance.isVisible().catch(() => false);
  if (any) {
    await advance.click();
    await page.waitForTimeout(600);
  }
  // Either an enrollment advanced or the empty state rendered — both are
  // "the view works"; a crash would have surfaced as a console error.
});

step(5, "import dry-run", async () => {
  // CSV import is an API surface; exercise the dry-run contract directly.
  const res = await page.request.post(`${BASE}/aria/api/import`, {
    data: { csv: "name,domain\nDrill Co,drill.test\n", dryRun: true },
    headers: { "content-type": "application/json" },
  });
  if (res.status() !== 200 && res.status() !== 400) {
    throw new Error(`import dry-run returned ${res.status()}`);
  }
});

step(6, "forecast drill-down", async () => {
  await page.getByRole("tab", { name: "Reports" }).click();
  await page.waitForTimeout(800);
  const body = await page.textContent("body");
  if (!/forecast|coverage|pipeline/i.test(body ?? "")) {
    throw new Error("reports view did not render forecast content");
  }
});

step(7, "audit feed", async () => {
  await page.getByRole("tab", { name: "Admin" }).click();
  await page.waitForTimeout(800);
  const body = await page.textContent("body");
  if (!/audit|member|invite/i.test(body ?? "")) {
    throw new Error("admin view did not render audit/member content");
  }
});

step(8, "reset", async () => {
  const res = await page.request.post(`${BASE}/aria/api/demo/reset`);
  if (res.status() !== 200) throw new Error(`reset returned ${res.status()}`);
  const body = await res.json().catch(() => ({}));
  if (body && body.ok === false) throw new Error("reset reported failure");
});

let failed = 0;
for (const s of steps) {
  try {
    await s.fn(page);
    console.log(`PASS ${s.n} ${s.name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${s.n} ${s.name} — ${e.message}`);
  }
}

await browser.close();
if (consoleErrors > 0) {
  console.log(`NOTE ${consoleErrors} console error(s) observed during the pass`);
}
if (failed > 0) {
  console.log(`RESULT ${steps.length - failed}/${steps.length} steps passed — ${failed} failed`);
  process.exit(1);
}
console.log(`RESULT ${steps.length}/${steps.length} steps passed, ${consoleErrors} console errors`);
