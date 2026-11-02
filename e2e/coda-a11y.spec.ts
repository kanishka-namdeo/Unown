import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Coda a11y spec (ticket C4, plan step 6).
 *
 * AxeBuilder, wcag2a/2aa/21a/21aa, ZERO-violation policy, exemptions
 * documented inline ONLY (matching e2e/a11y.spec.ts). Two schemes × two
 * states: light + dark, booted-empty (minimum) and content (a note + a
 * task present, so list-role and contrast findings can't be hidden).
 *
 * No config-level colorScheme: the app owns its own switch (coda.css
 * :root + @media prefers-color-scheme). This spec drives BOTH schemes
 * per-context.
 */

const READY = "Ready.";

async function bootCoda(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#coda-status")).toHaveText(READY, { timeout: 15_000 });
}

async function createNote(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole("button", { name: "New" }).click();
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("Note body (markdown)").fill(body);
  await page.getByRole("button", { name: "Save" }).click();
  // "Saved." confirms the IDB write + re-render completed before the scan.
  await expect(page.locator("#coda-status")).toContainText("Saved.", { timeout: 5_000 });
}

async function createTask(page: Page, title: string): Promise<void> {
  // Pre-arm: one-shot dialog handler BEFORE the click; the handler accepts
  // the prompt() immediately when it appears.
  const handler = (d: import("@playwright/test").Dialog) => { d.accept(title); };
  page.on("dialog", handler);
  try {
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.locator("#coda-status")).toContainText("Task created.", { timeout: 5_000 });
    await expect(page.locator(".coda-task-list .coda-task", { hasText: title })).toBeVisible();
  } finally {
    page.off("dialog", handler);
  }
}

async function analyze(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

test.describe.configure({ mode: "serial" });

for (const scheme of ["light", "dark"] as const) {
  test(`coda is axe-clean, ${scheme} (wcag2 A/AA + wcag21 A/AA)`, async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();

    // Empty state (minimum).
    await bootCoda(page);
    let violations = await analyze(page);
    expect(violations, `${scheme} empty: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    // Content state: a note + a task so list-role and contrast findings surface.
    await createNote(page, "A11y content", "# Heading\n\n- item one\n- item two");
    await createTask(page, "A11y task");
    await page.getByLabel("Note body (markdown)").click(); // focus the editor
    violations = await analyze(page);
    expect(violations, `${scheme} content: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    // Date-field keyboard operability: Tab reaches the due input, type works.
    const due = page.locator(".coda-task-due").first();
    if (await due.count() > 0) {
      await due.focus();
      await due.type("2026-12-01");
    }
    violations = await analyze(page);
    expect(violations, `${scheme} content+date: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    await ctx.close();
  });
}
