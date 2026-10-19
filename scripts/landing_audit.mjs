#!/usr/bin/env node
/**
 * landing_audit.mjs — quantifies the "too much scroll / too text-heavy" problem.
 *
 * Loads the landing page (dev or prod URL), measures:
 *   - total page height in px and in viewport-heights (1440x900 desktop)
 *   - per top-level <section> (and any [data-section]) : height, heading, word
 *     count of visible text, count of <p> elements
 *   - total word count of the page
 *
 * Usage:
 *   LANDING_AUDIT_URL=http://localhost:3000 node scripts/landing_audit.mjs
 *   node scripts/landing_audit.mjs --budget   # exit 1 on a budget breach
 *
 * The budget (the 2026-10-20 redesign's regression gate, mirrored in the
 * landing AGENTS.md and CI's landing job):
 *   - the document must stay ≤ 13 viewports tall at 1440x900
 *   - the visible word count must stay ≤ 3,200
 *   - no single top-level band may exceed 3 viewports on its own
 * Never settle a breach by deleting a generated number or a gated literal —
 * compress elsewhere (tabs, expanders, cut restated facts). See the scroll
 * budget contract in src/components/landing/AGENTS.md.
 *
 * Output: JSON to stdout (also saved to download/landing/audit.json)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.LANDING_AUDIT_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "download", "landing");
const BUDGET = process.argv.includes("--budget");
const MAX_VH = 13;
const MAX_WORDS = 3200;
const MAX_BAND_VH = 3;

let chromium = null;
for (const c of [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean)) {
  try {
    const mod = c.includes("node_modules") || c.startsWith("/") || c.startsWith("file:")
      ? await import(new URL(`file://${c}`).href.startsWith("file://") ? c : `file://${c}`).catch(() => null)
      : await import(c).catch(() => null);
    if (mod?.chromium) { chromium = mod.chromium; break; }
  } catch {}
}
if (!chromium) { console.error("no playwright found"); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500); // let reveals settle
// neutralize scroll-reveal opacity so text is "present" for measurement
await page.addStyleTag({ content: `*,*::before,*::after{transition:none!important;animation-duration:0.001s!important}` });

const metrics = await page.evaluate(() => {
  const vh = window.innerHeight;
  const main = document.querySelector("main");
  const sections = [...main.querySelectorAll(":scope > section, :scope > div > section")].map((s) => {
    const h2 = s.querySelector("h2, h1");
    const rect = s.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const text = s.innerText || "";
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return {
      id: s.id || null,
      heading: h2 ? h2.innerText.replace(/\s+/g, " ").trim().slice(0, 80) : null,
      top: Math.round(top),
      heightPx: Math.round(rect.height),
      heightVh: +(rect.height / vh).toFixed(2),
      words,
      paragraphs: s.querySelectorAll("p").length,
      lists: s.querySelectorAll("ul,ol").length,
    };
  });
  const bodyWords = (document.body.innerText || "").trim().split(/\s+/).filter(Boolean).length;
  return {
    viewport: { w: window.innerWidth, h: vh },
    pageHeightPx: Math.round(document.documentElement.scrollHeight),
    pageHeightVh: +(document.documentElement.scrollHeight / vh).toFixed(1),
    bodyWords,
    sections,
  };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "audit.json"), JSON.stringify(metrics, null, 2));
console.log(`Page: ${metrics.pageHeightPx}px = ${metrics.pageHeightVh} viewports tall @1440x900; ${metrics.bodyWords} words total; ${metrics.sections.length} sections`);
for (const s of metrics.sections) {
  console.log(
    `${String(s.heightVh).padStart(5)}vh ${String(s.heightPx).padStart(6)}px ${String(s.words).padStart(5)}w p:${s.paragraphs} | ${(s.heading ?? s.id ?? "?").slice(0, 60)}`,
  );
}
await browser.close();

if (BUDGET) {
  const breaches = [];
  if (metrics.pageHeightVh > MAX_VH) breaches.push(`page ${metrics.pageHeightVh}vh > ${MAX_VH}vh`);
  if (metrics.bodyWords > MAX_WORDS) breaches.push(`${metrics.bodyWords} words > ${MAX_WORDS}`);
  for (const s of metrics.sections) {
    if (s.heightVh > MAX_BAND_VH) breaches.push(`band "${(s.heading ?? s.id ?? "?").slice(0, 40)}" ${s.heightVh}vh > ${MAX_BAND_VH}vh`);
  }
  if (breaches.length) {
    console.error(`\nFAIL  scroll budget breach: ${breaches.join("; ")}`);
    console.error("      compress per the AGENTS.md contract — never delete a generated number or gated literal");
    process.exit(1);
  }
  console.log(`\nPASS  scroll budget: ${metrics.pageHeightVh}vh ≤ ${MAX_VH}, ${metrics.bodyWords}w ≤ ${MAX_WORDS}, every band ≤ ${MAX_BAND_VH}vh`);
}
