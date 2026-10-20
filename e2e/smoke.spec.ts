import { expect, test, type Page } from "@playwright/test";

/**
 * Dashboard E2E smoke (gate 16, part 1): the eleven tabs render live engine
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
  { name: "Automations", proof: "nightly repo health check", expand: true },
  { name: "Web Cache", proof: "bun sqlite tutorial" },
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

test("all eleven tabs render engine data", async ({ page }) => {
  // The tab strip grew to eleven tabs; clicking through each (pane fade +
  // engine-data proof, up to 10s apiece on a slow pane) outgrew the default
  // 30s TEST budget — the timeout surfaced as a phantom "tab not found" on
  // whichever tab the clock died on. A verified-good run measures ~25-35s.
  test.setTimeout(90_000);
  const errors = collectBrowserErrors(page);
  await page.goto("/dashboard");

  // KPIs from the mock engine's /api/overview are on screen.
  await expect(page.getByText("89%", { exact: true })).toBeVisible();
  await expect(page.getByText("132 runs").first()).toBeVisible();

  for (const tab of TABS) {
    const tabLocator = page.getByRole("tab", { name: tab.name });
    // The tab strip overflows once the 11th tab joined — scroll the target
    // into view before clicking or the click waits out the timeout on a
    // tab that is rendered but off-strip.
    await tabLocator.scrollIntoViewIfNeeded();
    await tabLocator.click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    // The dream journal / run-history panes gate their output behind a
    // disclosure toggle — expand before asserting the proof string. Match the
    // TOGGLE by its disclosure label ("expand"/"collapse"/"run history"):
    // a generic `button[aria-expanded="false"]` .first() grabbed the pane's
    // "New automation" dialog trigger instead, and the dialog's focus trap
    // set aria-hidden on <main> — hiding the whole tab strip from the
    // accessibility tree and failing the NEXT tab lookup as a phantom
    // "tab not found".
    if ("expand" in tab) {
      await page
        .getByRole("tabpanel")
        .getByRole("button", { name: /expand|collapse|run history/i })
        .first()
        .click();
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

test("the web cache tab deep-links via ?tab=webcache and renders its heading", async ({ page }) => {
  // The URL (?tab=) is the durable, shareable source of truth (tab-store.ts).
  await page.goto("/dashboard?tab=webcache");

  await expect(page.getByRole("tab", { name: "Web Cache" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(page.getByText("Web results store", { exact: true })).toBeVisible();
  // KPIs from the mock engine's /api/webcache are on screen (69% hit rate).
  await expect(page.getByText("69%", { exact: true })).toBeVisible();
  await expect(page.getByText("bun sqlite tutorial").first()).toBeVisible();
});
