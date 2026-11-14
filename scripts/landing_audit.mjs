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
 *   - the document must stay ≤ 15.0 viewports tall at 1440x900
 *   - the readable word count must stay ≤ 3,500
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
 * The 2026-10-29 SOTA-round amendment: 14.5 → 15.0vh and 3,320 → 3,500w.
 * The round rebuilt the eleventh band into the mission's showcase — the
 * live loop receipts (the six-row tally: 3 skills minted, project memory
 * v46, 50 dreams, the solvability gate's discards, the honest null, the
 * Fugue build lineage) beside four Mission Control stills from the round's
 * own capture lane — measured 1.23vh / 228w, replacing the band's midpoint
 * form at 0.97vh / 129w (+0.26vh / +99w; the page measured 14.5vh / 3,314w
 * at the deterministic replay-finished state — the old vh ceiling EXACTLY,
 * zero headroom left, and 6 words under the old word ceiling). Compressed
 * first: the FAQ's fattest prose — the capabilities and tests answers and
 * the data file's own header — plus six lexicon decode lines, 184 words of
 * file prose (faq-data.ts 822 → 653, lexicon.ts 1545 → 1530), no generated
 * number or gated literal touched. The ceilings carry the band's measured
 * growth plus headroom the measurement itself argues for: a cold-boot first
 * load this round measured 3,425w (the bounded replay wait fell through
 * mid-flight — the exact timing class the carving-round correction
 * documents), and the rail adds ~30 generated words per release stop, so a
 * 3,320-class ceiling is a knife's edge the page no longer sits inside
 * honestly.
 *
 * The 2026-10-29 amendment (the parley round): 13.5 → 14.5vh carries the
 * page's ELEVENTH band — "Built & Improved With Unown", the mission's
 * showcase deliverable (the before/after improvement receipts, the
 * learning-lane counters, three reused Mission Control stills). The band
 * was compressed before the amendment (measured 1.12vh / 220w →
 * 0.97vh / 129w: the cards' loop prose and the counters' note lines moved
 * into the data file + the reports, spacing tightened one step); the
 * remaining 0.97vh is the receipts-and-stills surface itself, and every
 * other band kept its height. The word budget is UNCHANGED at 3,320 — the
 * compression paid for the band's prose inside the old number.
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
const MAX_VH = 20.5;
// 2026-11-10 (the fifteenth amendment, the end-user combination round's
// F0c close-out): 17.5 -> 20.5vh — both twins together (the 0.0.48
// no-divergence lesson; the e2e twin carries the full receipt). Three
// product bands landed since the fourteenth amendment without carrying
// their ceilings (Chaconne, Fugue, Legato — +1.0vh each per the
// thirteenth amendment's user-product precedent); Fugue/Legato ledes
// compressed FIRST (-37 measured words, no generated number, no gated
// literal touched).
// 2026-10-31: reunited with the e2e twin (3,860) — the 0.0.48 release
// amendment moved only the e2e spec, leaving this copy at 3,800 while the
// page measured 3,838; the landing AGENTS.md rule is "the twin gates must
// not diverge". The sessions round's M4 checkpoint then recorded a false
// green from this script's mid-replay under-count against the stale
// ceiling. Both twins now carry the 47th-stop amendment (3,840 -> 3,860).
// 2026-10-31 (the tenth amendment, the 0.0.50 cut): 3,860 -> 3,880 — both
// twins together, per the same rule. The rail's 48th stop measured +21 of
// undeletable chrome (3,871). Compressed FIRST: the round's own listed
// title ("The plan file" -> "Plan file") plus the loop band's Work-lead
// restatement (-8 measured); post-compression 3,863. The e2e twin stays
// canonical (this script's bounded replay wait can fall through and
// under-count mid-flight).
// 2026-10-31 (the eleventh amendment, the 0.0.52 cut): 3,880 -> 3,920 —
// both twins together, per the same rule. The tenth left 17 words of
// headroom; the 0.0.51 stop consumed it exactly (3,880/3,880) and the
// 0.0.52 stop measured +20 (3,900). Compressed FIRST: the round's own
// listed title ("The Interface section — the S2-1 repair" -> "The
// Interface section", -4w); post-compression 3,896 — still 16 over, all
// undeletable stop chrome, so the ceiling carries it plus one more
// stop's headroom per the 0.0.44 rule.
// 2026-11-01 (the twelfth amendment, the 0.0.54 cut): 3,920 -> 3,950 —
// both twins together, per the same rule. The rail's 52nd stop measured
// the page at 3,930, ten over — all of it the stop's undeletable chrome
// (label + date + counts line). The sanctioned title compression was a
// page-level NO-OP: the rail prints titles only for the Added/Behavior
// buckets, and this stop's entries are Changed/Fixed, so the measured
// count stayed 3,930 (the lesson is recorded in the e2e twin's comment).
// The ceiling carries the chrome plus one more stop's (~20w) headroom
// per the 0.0.44 rule. The vh twin measured 15.4 against its own 15.5
// ceiling and moves nothing. No generated number, no gated literal
// touched.
/*
 * 2026-11-04 (the fourteenth amendment, the Ostinato round's O-6 closeout):
 * 16.5 -> 17.5vh and 4060 -> 4170w — both twins together (the 0.0.48
 * no-divergence lesson). The Ostinato band (the page's SECOND user-product
 * band, after Coda's thirteenth amendment) measured 17.3vh / 4,145w at
 * the bounded replay-wait state, the band itself 0.98vh / 104w (the
 * identity-pair stills the operator picked — the palette + the revealed
 * markdown back — one row of two stills + kicker + lede + the one
 * receipted battery figure + the two receipt links; the 2x2 four-still
 * grid measured 17.8vh / 4,175w and was compressed down to the pair
 * per the round's 13th-amendment +1.0vh precedent). The ceiling carries
 * the band's measured growth plus one rail-stop's (~20w) headroom per
 * the 0.0.44 rule (the 13th amendment's arithmetic: measured 16.3 ->
 * ceiling 16.5; measured 4,033 -> ceiling 4,060). Compressed FIRST, as
 * the contract demands: no further authored prose in the band was cut —
 * the lede is already minimal and the captions are one-liners; no
 * generated number, no gated literal touched. DRAFT ledger entry for
 * the operator to land in src/components/landing/AGENTS.md (chunk 1 of
 * O-6 carries the draft; this script's comment records the measurement
 * until it lands).
 */
/*
 * The 2026-11-10 fifteenth amendment (the end-user combination round's
 * F0c close-out): 4,170 -> 4,570w — both twins together. See the e2e
 * twin's fifteenth-amendment comment for the receipt (three product
 * bands carried; ledes compressed first, -37 measured words; no
 * generated number, no gated literal touched).
 */
/*
 * The 2026-11-12 SIXTEENTH amendment (the Memory v2 round's v0.0.64 cut):
 * 4,570 -> 4,590w — both twins together (the 0.0.48 no-divergence lesson).
 * The rail's 59th stop breached at 4,586w; compressed FIRST (the round's
 * own listed titles + three historical first-listed leads, -10 measured
 * rendered-title words — the Behavior-bucket compressions are hygiene,
 * not budget, the MAX_LISTED=1 lesson); post-compression 4,574. The
 * ceiling carries the stop's undeletable chrome (label, date, tally,
 * "+N more") plus one more stop's (~20w) headroom per the 0.0.44 rule.
 * The e2e twin carries the full receipt.
 */
// The 2026-11-15 v0.0.66 release amendment: 4,590 -> 4,612 carries the
// rail's 61st stop (the ~+23w structural cost; the round's own titles
// compressed first, -2w; the historical-lead lesson re-learned: only the
// latest stop's items render). Both twins move together — the 0.0.48 lesson.
const MAX_WORDS = 4612;
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
let replayFinished = false;
try {
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
  );
  replayFinished = true;
} catch {
  // The 2026-10-29 validation round's twin-gate fix: a fall-through here is
  // a MID-REPLAY measure (under-count vs the e2e twin's finished state —
  // observed live: 3,590w vs 3,731w). Never silent: warn, and let the
  // --budget verdict still run (the e2e spec stays canonical).
  console.error(
    "WARN: the session replay did not reach its finished state within the bounded wait — this measure is MID-REPLAY and under-counts; the e2e twin (e2e/landing-budget.spec.ts) is the canonical gate.",
  );
}
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
