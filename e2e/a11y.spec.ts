import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility gate (gate 16, part 2 / strategy §12 criterion 6): axe-core,
 * WCAG 2.0/2.1 A + AA rule set, on the landing page under the page's native
 * dark scheme. Zero-violation policy: a finding here is a real defect to fix
 * in the components, not a rule to disable — the only allowed exemptions are
 * documented inline below. (The dashboard-tab scans left with the web
 * dashboard — D7; the TUI dashboard is axe-irrelevant by construction.)
 */

async function analyze(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

/**
 * axe treats a node at opacity 0 as hidden, and every landing section starts
 * there (`FadeUp`'s `whileInView`, once). A scan taken without revealing the
 * document inspects the first screenful and calls the other ~90% of the page
 * clean — which is how three WCAG 1.4.1 findings (in-text links distinguishable
 * only by color) sat on the page through a green gate.
 *
 * Two passes, because they prove different things:
 *  - **reduced motion** is the complete-document scan: the folder's own
 *    contract says motion is additive, never load-bearing, so under
 *    `prefers-reduced-motion` every section renders in its final state with no
 *    scroll required. This pass is what makes "axe-clean" mean the whole page.
 *  - **no preference + a scroll sweep** is the state a reader actually arrives
 *    at. The sweep is not a guarantee: a programmatic 500px/120ms walk was
 *    measured leaving one wrapper parked at `opacity:0;translateY(20px)`
 *    because its IntersectionObserver callback never landed, which is the
 *    reason the reduced pass sits beside it rather than after it.
 *
 * A fixed settle sleep is the wrong instrument at both ends: 1.5s scanned
 * mid-fade nodes (a nonsense contrast ratio against a blended background),
 * 4s was pure slack. The plateau check waits until the count of partially
 * transparent nodes stops moving.
 */
async function revealAll(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __qPrev?: number; __qAt?: number };
      const mid = () =>
        [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => {
          const o = parseFloat(getComputedStyle(e).opacity);
          return o > 0.05 && o < 0.999;
        }).length;
      const n = mid();
      const now = Date.now();
      if (w.__qPrev === undefined || now - w.__qAt! > 700) {
        w.__qPrev = n;
        w.__qAt = now;
        return false;
      }
      return w.__qPrev === n;
    },
    undefined,
    { timeout: 20_000, polling: 350 },
  );
}

for (const mode of ["reduced (full document)", "animated (as read)"] as const) {
  // Full-document axe scans of a ~13vh page (plus the revealAll sweep on the
  // animated pass) measure ~31s on slower runners — the 30s default is a
  // coin flip there. 60s keeps the gate about violations, not clock speed.
  test.setTimeout(60_000);
  test(`landing page is axe-clean, ${mode} (wcag2 A/AA + wcag21 A/AA)`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({
      baseURL,
      colorScheme: "dark",
      viewport: { width: 1280, height: 900 },
      reducedMotion: mode.startsWith("reduced") ? "reduce" : "no-preference",
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await revealAll(page);
    const violations = await analyze(page);
    expect(violations, `${mode}: ` + JSON.stringify(violations, null, 2)).toEqual([]);
    await ctx.close();
  });
}