import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Coda offline-first spec (ticket C4, plan step 6).
 *
 * Automates the operator's receipted manual proof: SW controlled → offline
 * reload → offline create → survives. The plan's "reload each route" maps
 * to this one-route SPA's two primary surfaces — the notes list and the
 * tasks board — both asserted after the offline reload.
 *
 * No fixed sleeps anywhere: the app's real ready signal is the sticky
 * status text flipping from "Booting…" to "Ready." (app.ts boot()).
 */

const READY = "Ready.";

async function bootCoda(page: Page): Promise<void> {
  await page.goto("/");
  // app.ts boot(): IDB load → seed/persist → renderAll → status "Ready."
  await expect(page.locator("#coda-status")).toHaveText(READY, { timeout: 15_000 });
  // C3's clients.claim() makes the FIRST load already controlled.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
}

async function createNote(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole("button", { name: "New" }).click();
  // renderEditor only renders inputs for a SELECTED note; a freshly
  // created empty note becomes the active one on click.
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("Note body (markdown)").fill(body);
  await page.getByRole("button", { name: "Save" }).click();
  // "Saved." is the transient status that confirms the IDB write completed.
  await expect(page.locator("#coda-status")).toContainText("Saved.", { timeout: 5_000 });
}

/**
 * PRE-ARMED dialog handling (browser-autonomy round 2 lesson): the listener
 * is registered BEFORE the triggering click. The task-create path is
 * prompt()-based; an unhandled dialog auto-dismisses in Playwright and
 * cancels the flow.
 */
async function createTask(page: Page, title: string): Promise<void> {
  // Pre-arm: register a one-shot dialog handler BEFORE the click. The
  // handler accepts the prompt() immediately when it appears, so the
  // click's post-actionability state is not blocked.
  const handler = (d: import("@playwright/test").Dialog) => { d.accept(title); };
  page.on("dialog", handler);
  try {
    await page.getByRole("button", { name: "Add task" }).click();
    // "Task created." confirms newTask() → persist() completed.
    await expect(page.locator("#coda-status")).toContainText("Task created.", { timeout: 5_000 });
    await expect(page.locator(".coda-task-list .coda-task", { hasText: title })).toBeVisible();
  } finally {
    page.off("dialog", handler);
  }
}

async function closeNoteConfirm(page: Page): Promise<Page> {
  // Arm the note delete confirm() so an accidental click never dead-ends
  // the spec; returns the page for chaining.
  page.on("dialog", (d) => void d.accept());
  return page;
}

test.describe.configure({ mode: "serial" });

test("coda boots controlled, offline reload keeps data, offline create survives", async ({ browser }) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // Fresh context: no SW, no IDB. Boot to a controlled page.
  await bootCoda(page);

  // P0 installability: the manifest must fetch.
  const manifestRes = await page.request.get("/public/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);

  // Create a note AND a task through the real UI (dialog pre-armed).
  await createNote(page, "Offline proof", "# First note\n\nSurvives the reload.");
  await createTask(page, "Survive offline");
  await closeNoteConfirm(page);

  // Offline reload #1: both primary surfaces show the saved data.
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator("#coda-status")).toHaveText(READY, { timeout: 15_000 });
  await expect(page.locator(".coda-list .coda-note-open", { hasText: "Offline proof" })).toBeVisible();
  await expect(page.locator(".coda-task-list .coda-task", { hasText: "Survive offline" })).toBeVisible();

  // Offline-first create: a SECOND note while still offline, reload again.
  await createNote(page, "Offline second", "# Created offline");
  await ctx.setOffline(true); // already offline; reload still offline
  await page.reload();
  await expect(page.locator("#coda-status")).toHaveText(READY, { timeout: 15_000 });
  await expect(page.locator(".coda-list .coda-note-open", { hasText: "Offline second" })).toBeVisible();

  await ctx.close();
});

test("offline navigation to a non-precached URL lands on the offline page", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await bootCoda(page);
  await ctx.setOffline(true);
  // A same-origin URL NOT in the precache list: sw.js's navigation
  // fallback serves public/offline.html from cache.
  await page.goto("/public/offline-missing.html");
  await expect(page.locator("h1")).toContainText("You\u2019re offline");
  await ctx.close();
});

test("beforeinstallprompt is soft-gated (never a hard fail)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await bootCoda(page);
  // Headless Chromium doesn't reliably fire beforeinstallprompt.
  const installPrompt = page.waitForEvent("beforeinstallprompt" as unknown as "worker", { timeout: 3_000 }).catch(() => null);
  await page.goto("/"); // already booted; just observe
  const evt = await installPrompt;
  // Record, don't assert: the plan's P1 pitfall.
  if (evt) {
    console.log("[coda] beforeinstallprompt observed (soft-gate)");
  } else {
    console.log("[coda] beforeinstallprompt not fired (expected in headless; soft-gate)");
  }
  await ctx.close();
});
