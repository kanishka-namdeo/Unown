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
 *   - the document must stay ≤ 13.5 viewports tall at 1440x900
 *   - the readable word count must stay ≤ 3,320
 *
 * The 2026-10-28 measurement correction (the carving round): two changes
 * made the count deterministic, without touching the budget number —
 *   1. the session replay's autoplay made the old count timing-dependent:
 *      the visible transcript types itself in over ~9s (0..111 words), so a
 *      measure taken at "networkidle + 2.5s" landed anywhere in that
 *      window — rounds recorded numbers that differed by up to ~90 words
 *      on the same build. The audit now waits for the replay's timer to
 *      read finished (bounded; reduced-motion renders finished
 *      instantly, a missing timer falls straight through).
 *   2. `innerText` counts the page's sr-only a11y lanes — spoken
 *      annotations that no scrolling visitor reads — and the replay's
 *      transcript therefore counted TWICE at finish (the animated screen
 *      plus its figcaption). sr-only words are subtracted so the gate
 *      counts readable copy exactly once. Measured effect on this page:
 *      246 annotation words (the transcript, the dex's "entry N of 22"
 *      tails, the copy buttons' "Copied" status regions).
 *   Both gates (this script and e2e/landing-budget.spec.ts) measure the
 *   same way; the budget number itself is unchanged because the
 *   deterministic readable count (3,153 at the finish, pre-0.0.37 stop)
 *   sits well inside 3,320 — the old green numbers were riding on
 *   mid-replay measurement, not on a smaller page.
 *
 * The 2026-10-28 amendments: the live-preview round (13 → 13.5vh, 3,200 →
 * 3,250w) carried the page's first interactive-application frame; the
 * commerce round (3,250 → 3,290w) carries the second one AND the rail's
 * structural cost — every release stop adds ~30 rendered words to the
 * changelog band (title + tally + stop chrome, all generated — the
 * compression contract never allows deleting a generated number), so a
 * band that grows by one stop per release needs the words the stop brings.
 * The gallery's own chrome was compressed first (the band's per-app kind
 * line, the rounds chip and the lead were cut — measured 3,308 → 3,282
 * before the amendment; the band itself reads 47 words / 1.1vh).
 * band — the page's first interactive-application frame — pays for itself
 * (lazy-mounted 540px frame, one-line lead, receipt chips: 68 words,
 * 1.09vh) and every other band kept its height; the increase is the
 * frame's, not prose. The contract's spirit (attention above the fold,
 * docs/landing-research.md) is about readable prose density, and an app
 * frame is interactive surface, not scroll-past copy.
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
const MAX_VH = 13.5;
const MAX_WORDS = 3320;
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
// The session replay autoplays once (~9s of typing). The word count must be
// measured at its FINISHED state or it is timing-dependent — see the header.
// Reduced-motion contexts render finished instantly; a missing timer (no
// hydration, very slow CI) falls through after the bounded wait.
await page.waitForFunction(
  () => {
    const timer = [...document.querySelectorAll("span")].find((s) =>
      /^\d+\.\ds \/ \d+\.\ds$/.test((s.textContent ?? "").trim()),
    );
    if (!timer) return false;
    const m = timer.textContent.trim().match(/(\d+\.\d)s \/ (\d+\.\d)s/);
    return Number(m[1]) === Number(m[2]);
  },
  undefined,
  { timeout: 15000 },
).catch(() => {});
await page.waitForTimeout(2500); // let reveals settle
// neutralize scroll-reveal opacity so text is "present" for measurement
await page.addStyleTag({ content: `*,*::before,*::after{transition:none!important;animation-duration:0.001s!important}` });

const metrics = await page.evaluate(() => {
  const vh = window.innerHeight;
  // Readable words: innerText minus the sr-only a11y lanes (spoken
  // annotations — the replay's transcript figcaption, the dex's tally
  // tails, the copy buttons' status regions). They are rendered, so
  // innerText counts them, but no scrolling visitor reads them — and the
  // replay's transcript would otherwise count twice (screen + figcaption).
  const countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
  const srOnlyWords = [...document.querySelectorAll(".sr-only")].reduce(
    (n, el) => n + countWords(el.innerText),
    0,
  );
  const readableWords = (root) => {
    // subtract the sr-only words that fall inside `root`
    const inner = [...root.querySelectorAll(".sr-only")].reduce(
      (n, el) => n + countWords(el.innerText),
      0,
    );
    return countWords(root.innerText) - inner;
  };
  const main = document.querySelector("main");
  const sections = [...main.querySelectorAll(":scope > section, :scope > div > section")].map((s) => {
    const h2 = s.querySelector("h2, h1");
    const rect = s.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    return {
      id: s.id || null,
      heading: h2 ? h2.innerText.replace(/\s+/g, " ").trim().slice(0, 80) : null,
      top: Math.round(top),
      heightPx: Math.round(rect.height),
      heightVh: +(rect.height / vh).toFixed(2),
      words: readableWords(s),
      paragraphs: s.querySelectorAll("p").length,
      lists: s.querySelectorAll("ul,ol").length,
    };
  });
  const bodyWords = countWords(document.body.innerText) - srOnlyWords;
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
