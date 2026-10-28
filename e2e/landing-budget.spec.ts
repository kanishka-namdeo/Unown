import { expect, test } from "@playwright/test";

/**
 * The scroll-budget gate (testing-strategy.md §6; the landing folder's
 * AGENTS.md "scroll budget is a contract" bullet).
 *
 * The 2026-10-20 redesign merged fourteen sections (21.5 viewports, 5,488
 * words at 1440x900) into eight bands. The research that motivated it
 * (docs/landing-research.md, "2026-10-20 — the eight-band compression"):
 * ~57% of visitor attention lands above the fold and 74% within two
 * screenfuls, and the most-copied dev-tool pages run 500-1,700 words — the
 * back half of a 14-section page was nearly unread real estate. This spec is
 * what keeps the page from growing back, without punishing a future edit
 * that adds a band while compressing elsewhere.
 *
 * Never settle a breach by deleting a generated number or a gated literal —
 * those are receipts. Compress: tabs, expanders, cut restated facts.
 *
 * The 2026-10-29 SOTA-round amendment: 14.5 -> 15.0vh and 3,320 -> 3,500w.
 * The round rebuilt the eleventh band into the mission's showcase - the
 * live loop receipts (the six-row tally: 3 skills minted, project memory
 * v46, 50 dreams, the solvability gate's discards, the honest null, the
 * Fugue build lineage) beside four Mission Control stills from the round's
 * own capture lane - measured 1.23vh / 228w, replacing the band's midpoint
 * form at 0.97vh / 129w (+0.26vh / +99w; the page measured 14.5vh / 3,314w
 * at the deterministic replay-finished state - the old vh ceiling EXACTLY,
 * zero headroom left, and 6 words under the old word ceiling). Compressed
 * first: the FAQ's fattest prose (the capabilities and tests answers, the
 * data file's own header) plus six lexicon decode lines, 184 words of file
 * prose (faq-data.ts 822 -> 653, lexicon.ts 1545 -> 1530), no generated
 * number or gated literal touched. The ceilings carry the band's measured
 * growth plus headroom the measurement itself argues for: a cold-boot
 * first load this round measured 3,425w (the bounded replay wait fell
 * through mid-flight - the timing class the carving-round correction
 * documents), and the rail adds ~30 generated words per release stop, so a
 * 3,320-class ceiling is a knife's edge the page no longer sits inside
 * honestly.
 *
 * The 2026-10-29 amendment (the parley round): 13.5 -> 14.5vh carries the
 * page's ELEVENTH band - "Built & Improved With Unown", the mission's
 * showcase deliverable (before/after improvement receipts, learning-lane
 * counters, three reused Mission Control stills). The band was compressed
 * before the amendment (1.12vh / 220w -> 0.97vh / 129w); the word budget
 * is UNCHANGED at 3,320 - the compression paid for the band's prose.
 *
 * The 2026-10-28 amendments: the live-preview round (13 → 13.5vh, 3,200 →
 * 3,250w) carried the first interactive-application frame; the commerce
 * round (3,250 → 3,290w) carries the second and the rail's structural
 * cost — every release stop adds ~30 generated words to the changelog
 * band (never deletable per the compression contract). The gallery's own
 * chrome was compressed first: measured 3,308 → 3,282 (band5: 47w / 1.1vh).
 * live-demo band — the page's first interactive-application frame (a
 * running app in an iframe). The band pays for itself: lazy-mounted frame,
 * one-line lead, receipt chips (68 words, 1.09vh measured); every other
 * band kept its height. The increase is the frame's, not prose — the
 * research's readability argument is about scroll-past copy, and an app
 * frame is interactive surface.
 *
 * `node scripts/landing_audit.mjs --budget` is the local, print-the-table
 * form of the same gate (it also writes download/landing/audit.json).
 */

const MAX_PAGE_VH = 15.0;
const MAX_WORDS = 3500;
const MAX_BAND_VH = 3;

// The contract measures at 1440x900 (landing AGENTS.md + the audit script).
// Playwright's default context is 1280x720, at which the same page measures
// ~3vh taller — pin the viewport or the gate is measuring a different page.
test.use({ viewport: { width: 1440, height: 900 } });

test("the landing page stays inside the scroll budget", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // The session replay autoplays once (~9s of typing) and its visible
  // transcript is up to 111 words — a measure taken mid-replay is
  // timing-dependent, which is how the same build recorded counts up to
  // ~90 words apart. Measure at the replay's FINISHED state (bounded wait;
  // reduced-motion contexts render finished instantly, a missing timer
  // falls through). The carving round, 2026-10-28.
  await page
    .waitForFunction(
      () => {
        const timer = [...document.querySelectorAll("span")].find((s) =>
          /^\d+\.\ds \/ \d+\.\ds$/.test((s.textContent ?? "").trim()),
        );
        if (!timer) return false;
        const m = timer.textContent.trim().match(/(\d+\.\d)s \/ (\d+\.\d)s/);
        return m !== null && Number(m[1]) === Number(m[2]);
      },
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
  // Neutralise reveal motion so every section measures at its finished
  // height and every word counts as present (same trick as the audit script).
  await page.addStyleTag({
    content: `*,*::before,*::after{transition:none!important;animation-duration:0.001s!important}`,
  });
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
    const countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
    // Readable words: innerText minus the sr-only a11y lanes — spoken
    // annotations no scrolling visitor reads (the replay's transcript
    // figcaption, the dex's tally tails, the copy buttons' status regions).
    // Without the subtraction the replay's transcript counts twice at
    // finish (the animated screen plus its figcaption). The audit script
    // measures the same way — the twin gates must not diverge.
    const srOnlyWords = [...document.querySelectorAll(".sr-only")].reduce(
      (n, el) => n + countWords((el as HTMLElement).innerText),
      0,
    );
    const main = document.querySelector("main");
    const sections = [...(main?.querySelectorAll(":scope > section") ?? [])].map((s) => {
      const h2 = s.querySelector("h2, h1");
      const heading = h2 ? (h2.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) : s.id;
      return {
        heading: heading || "(untitled)",
        heightVh: +(s.getBoundingClientRect().height / vh).toFixed(2),
      };
    });
    return {
      vh,
      pageVh: +(document.documentElement.scrollHeight / vh).toFixed(1),
      words: countWords(document.body.innerText) - srOnlyWords,
      sections,
    };
  });

  const breaches: string[] = [];
  if (m.pageVh > MAX_PAGE_VH) breaches.push(`page ${m.pageVh}vh > ${MAX_PAGE_VH}vh`);
  if (m.words > MAX_WORDS) breaches.push(`${m.words} words > ${MAX_WORDS}`);
  for (const s of m.sections) {
    if (s.heightVh > MAX_BAND_VH) breaches.push(`band "${s.heading}" ${s.heightVh}vh > ${MAX_BAND_VH}vh`);
  }

  const table = m.sections
    .map((s) => `  ${String(s.heightVh).padStart(5)}vh  ${s.heading}`)
    .join("\n");
  console.log(`scroll budget @${m.vh}px viewport: page ${m.pageVh}vh, ${m.words} words\n${table}`);

  expect(breaches, `budget breaches (compress per the landing AGENTS.md): ${breaches.join("; ")}`).toEqual([]);
});
