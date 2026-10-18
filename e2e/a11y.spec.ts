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
  { name: "Router", ready: "Pick a task, run it in a fresh sandbox, mine failures." },
  { name: "Automations", ready: "nightly repo health check" },
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

test("landing page is axe-clean (wcag2 A/AA + wcag21 A/AA)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const violations = await analyze(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

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
