import { expect, test, type Page } from "@playwright/test";

/**
 * Dashboard E2E smoke (gate 16, part 1): the nine tabs render live engine
 * data against the mock engine, the SSE stream feeds the activity strip, the
 * console prompt round-trips, and the browser console stays clean.
 */

const TABS = [
  { name: "Overview", proof: "fix-failing-test" },
  { name: "Learning Lab", proof: "patched project memory rule; candidate verified twice" },
  { name: "Memory", proof: "mock rule 1: prefer standard library functions" },
  { name: "Dreams", proof: "consolidated retry discipline into project memory", expand: true },
  { name: "Hooks", proof: "bash redirect escape" },
  { name: "Console", proof: "Send your first prompt." },
  { name: "Sandboxes", proof: "task-e2e-4/baseline" },
  { name: "Gateway", proof: "qwen3.7-plus" },
  { name: "Router", proof: "Pick a task, run it in a fresh sandbox, mine failures." },
] as const;

/** Collect browser-reported errors (console.error + uncaught page errors). */
function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

test("all nine tabs render engine data", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/dashboard");

  // KPIs from the mock engine's /api/overview are on screen.
  await expect(page.getByText("89%", { exact: true })).toBeVisible();
  await expect(page.getByText("132 runs").first()).toBeVisible();

  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab.name }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    // The dream journal gates its output + consumed notes behind an expand
    // toggle — expand before asserting the proof string.
    if ("expand" in tab) {
      await page.locator('button[aria-expanded="false"]').first().click();
    }
    await expect(page.getByText(tab.proof).first()).toBeVisible({ timeout: 10_000 });
  }

  // The strict part: a clean build against a healthy engine must not produce
  // a single console error or uncaught exception on any tab.
  expect(errors, `browser errors: ${errors.join("\n")}`).toEqual([]);
});

test("live SSE feed renders the canned event stream", async ({ page }) => {
  await page.goto("/dashboard");
  // hello event — the engine greets every connect.
  await expect(page.getByText("connected to agent event stream").first()).toBeVisible({ timeout: 10_000 });
  // scripted burst from the mock: a job finishing + a memory version shipping.
  await expect(page.getByText("job finished · note-sync").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("project memory → v5 · by autodream").first()).toBeVisible();
  // and the deny'd hook row (tone-rose path through describe()).
  await expect(page.getByText("hook PreToolUse · bash · deny").first()).toBeVisible();
});

test("console prompt round-trips through the mock engine", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("tab", { name: "Console" }).click();

  const box = page.getByPlaceholder(/Write a function that reverses/);
  await expect(box).toBeVisible();
  await box.fill("Reverse a linked list, with tests.");
  // The console submits on Ctrl/Cmd+Enter (its footer says so).
  await box.press("Control+Enter");

  // submitted -> engine accepted -> the interactive session appears.
  await expect(page.getByText("Prompt submitted")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/run-e2e-prompt-/).first()).toBeVisible({ timeout: 10_000 });
  // ~1.5s later the mock finishes the run and the transcript lands.
  await expect(page.getByText("Finished the requested edit.").first()).toBeVisible({ timeout: 10_000 });
});
