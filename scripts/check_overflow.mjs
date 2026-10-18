#!/usr/bin/env node
/**
 * check_overflow.mjs — deterministic text-overflow gate for the brand HTML
 * sources in scripts/brand/ (the sources are self-policed for palette; this
 * polices layout: no element may scroll beyond its box, no page may scroll
 * horizontally). VLM review can hallucinate "overlap"; this cannot.
 *
 * Usage: bun scripts/check_overflow.mjs [file.html ...]   (default: all
 * scripts/brand/*.html; diagram dimensions default to 1060x560 — banner and
 * social sizes are matched by filename).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const files = args.length > 0 ? args : readdirSync(join(process.cwd(), "scripts", "brand"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => join(process.cwd(), "scripts", "brand", f));

const sizeFor = (f) =>
  f.includes("banner") ? [1616, 420] : f.includes("social") ? [1280, 640] : [1060, 560];

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let anyIssue = false;
for (const file of files) {
const [w, h] = sizeFor(file);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const issues = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".tier .top, .kv, .badge, .chip, .tier .role, .resolved .head, .inject .txt")) {
    const overX = el.scrollWidth - el.clientWidth;
    const overY = el.scrollHeight - el.clientHeight;
    const cls = el.className || el.tagName;
    const txt = (el.textContent || "").trim().slice(0, 40);
    if (overX > 1 || overY > 1) out.push({ cls, txt, overX, overY });
    // child-level check for truncated flex rows
    for (const c of el.children) {
      const cx = c.scrollWidth - c.clientWidth;
      if (cx > 1) out.push({ cls: `child of ${cls}`, txt: (c.textContent || "").trim().slice(0, 40), overX: cx, overY: 0 });
    }
  }
  // whole body overflow
  const b = document.body;
  if (b.scrollWidth > b.clientWidth) out.push({ cls: "BODY", txt: "horizontal page overflow", overX: b.scrollWidth - b.clientWidth, overY: 0 });
  return out;
});
if (issues.length > 0) {
  anyIssue = true;
  console.log(`OVERFLOW in ${file}:`);
  console.log(JSON.stringify(issues, null, 2));
} else {
  console.log(`ok  ${file} — no element or page overflow`);
}
await page.close();
}
await browser.close();
process.exit(anyIssue ? 1 : 0);
