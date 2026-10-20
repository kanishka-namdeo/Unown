import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility gate (gate 16, part 2 / strategy §12 criterion 6): axe-core,
 * WCAG 2.0/2.1 A + AA rule set, on the landing page and every dashboard tab,
 * under the dashboard's native dark scheme. Zero-violation policy: a finding
 * here is a real defect to fix in the components, not a rule to disable —
 * the only allowed exemptions are documented inline below.
 */

const TABS = [
  { name: "Overview", ready: "132 runs" },
  { name: "Learning Lab", ready: "patched project memory rule; candidate verified twice" },
  { name: "Memory", ready: "mock rule 1: prefer standard library functions" },
  { name: "Dreams", ready: "consolidated retry discipline into project memory", expand: true },
  { name: "Hooks", ready: "bash redirect escape" },
  { name: "Sandboxes", ready: "task-e2e-4/baseline" },
  { name: "Gateway", ready: "qwen3.7-plus" },
  { name: "Providers", ready: "key: $AGNES_API_KEY" },
  { name: "Router", ready: "Pick a task, run it in a fresh sandbox, mine failures." },
  { name: "Automations", ready: "nightly repo health check" },
  { name: "Web Cache", ready: "bun sqlite tutorial" },
] as const;

/**
 * Let the live feed's entrance animations finish before axe samples colors:
 * framer-motion fades items in over ~0.2s, and a mid-flight item reads as a
 * contrast failure even though its final colors pass. The last scripted
 * canned event is the deterministic "feed is complete" marker.
 */
async function settleFeed(page: import("@playwright/test").Page) {
  try {
    await page.getByText("hook PreToolUse · bash · deny").first().waitFor({ state: "visible", timeout: 3000 });
    await page.waitForTimeout(300);
  } catch {
    // feed not mounted on this tab — nothing to settle
  }
}

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

for (const tab of TABS) {
  test(`dashboard tab "${tab.name}" is axe-clean (wcag2 A/AA + wcag21 A/AA)`, async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for the tab's panel to actually be mounted (radix unmounts hidden
    // tabs) and for engine data to be present before scanning — a tab-specific
    // sentinel: the Overview KPIs unmount the moment another tab activates.
    await page.getByRole("tab", { name: tab.name }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    if ("expand" in tab) {
      await page.locator('button[aria-expanded="false"]').first().click();
    }
    await expect(page.getByText(tab.ready).first()).toBeVisible({ timeout: 10_000 });
    await settleFeed(page);
    const violations = await analyze(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}

test("dashboard tab \"Console\" is axe-clean (wcag2 A/AA + wcag21 A/AA)", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("tab", { name: "Console" }).click();
  // The console's data-ready sentinel: the prompt box (present whether the
  // sessions list is empty or populated).
  await expect(page.getByPlaceholder(/Write a function that reverses/)).toBeVisible();
  const violations = await analyze(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});
