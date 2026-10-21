// m6-dash-verify.mjs — visual verification of the M6 dashboard changes:
//   1. Learning-lab runs table loads; clicking a run row opens the detail
//      dialog which shows the NEW "isolation: bwrap" field (M6-3)
//   2. The overview tab still renders KPIs + LIVE feed (regression)
//   3. Zero console errors / failed requests throughout
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/home/z/my-project/download/m6-dash-verify";
fs.mkdirSync(OUT, { recursive: true });

const exe = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

(async () => {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failed = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => failed.push(r.url().slice(0, 120)));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });

  const results = [];
  const check = (name, ok, detail = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`); };

  // 1. learning lab runs table + run detail dialog
  await page.goto("http://localhost:3000/dashboard?tab=lab", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/01-lab-tab.png`, fullPage: true });

  // find a run row with the bwrap isolation — rows are in the runs table; click the first row
  const row = page.locator("table tbody tr").first();
  const rowCount = await page.locator("table tbody tr").count();
  check("lab: runs table has rows", rowCount > 0, `rows: ${rowCount}`);
  if (rowCount > 0) {
    await row.click();
    await page.waitForTimeout(1800);
    const dialog = page.locator("[role='dialog']");
    await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const dialogText = (await dialog.count()) ? await dialog.innerText() : "";
    await page.screenshot({ path: `${OUT}/02-run-detail.png`, fullPage: true });
    check("run-detail: dialog opened on row click", !!dialogText, dialogText.split("\n").slice(0, 2).join(" | "));
    const isoMatch = dialogText.match(/isolation:\s*(\w+)/);
    check("run-detail: shows isolation field", !!isoMatch, isoMatch ? `isolation=${isoMatch[1]}` : "no isolation text found");
    check("run-detail: isolation is bwrap (real OS jail)", isoMatch?.[1] === "bwrap", "");
    // close dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // 2. overview regression
  await page.goto("http://localhost:3000/dashboard?tab=overview", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2200);
  const overviewText = await page.locator("main, body").first().innerText();
  await page.screenshot({ path: `${OUT}/03-overview.png`, fullPage: true });
  check("overview: KPIs render", /runs|cycles|pass/i.test(overviewText), "");
  check("overview: LIVE feed connected", /LIVE|connected/i.test(overviewText), "");

  // 3. console errors (dev-compile noise filtered)
  const realErrors = errors.filter((e) => !/devtools|webpack|sourcemap|fast refresh/i.test(e));
  check("console: zero real errors/warnings", realErrors.length === 0, realErrors.slice(0, 3).join(" ;; "));
  check("network: zero failed requests", failed.length === 0, failed.slice(0, 3).join(" ;; "));

  await browser.close();
  const ok = results.every(([, o]) => o);
  console.log(ok ? "ALL PASS" : "SOME FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
