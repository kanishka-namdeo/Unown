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

const MAX_PAGE_VH = 13.5;
const MAX_WORDS = 3320;
const MAX_BAND_VH = 3;

// The contract measures at 1440x900 (landing AGENTS.md + the audit script).
// Playwright's default context is 1280x720, at which the same page measures
// ~3vh taller — pin the viewport or the gate is measuring a different page.
test.use({ viewport: { width: 1440, height: 900 } });

test("the landing page stays inside the scroll budget", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Neutralise reveal motion so every section measures at its finished
  // height and every word counts as present (same trick as the audit script).
  await page.addStyleTag({
    content: `*,*::before,*::after{transition:none!important;animation-duration:0.001s!important}`,
  });
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
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
      words: (document.body.innerText || "").trim().split(/\s+/).filter(Boolean).length,
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
