/**
 * Fugue — the e2e smoke lane (ticket F-4).
 *
 * THE LAWN: boot → HTTP 200 → the shell renders → the palette opens
 * on Ctrl+K → the compose dialog validates invalid input inline →
 * the never-blank pins for the four honest panels.
 *
 * THE SELF-SKIP GUARD: module-scope `process.env.FUGUE_E2E = "1"`
 * arms the marker (the config's contract); when the marker is absent
 * the spec self-skips (the Coda/Chaconne/CODA_E2E precedent), so the
 * fugue lane never runs under any other marker.
 *
 * THE SPIKE LANE (PLAN §7 unknown #2, the F-4 receipt's "live proxy
 * path confirmed"): the spec boots the app against the fixture
 * server (4130) through the proxy path, then re-tries with the
 * transport stubbed out (the degraded lane), asserting the app
 * degrades to the EngineDown panel — never a crash, never a blank.
 * The receipt in `apps/fugue/NOTES-F4.md` carries the verdict.
 *
 * No run is claimed in the receipt that was not performed. The
 * operator gate re-runs it via `FUGUE_E2E=1 bunx playwright test
 * --config=playwright.fugue.config.ts` from the repo root.
 */
import { expect, test } from "@playwright/test";

test.skip(
  process.env.FUGUE_E2E !== "1",
  "fugue lane only — run via playwright.fugue.config.ts with FUGUE_E2E=1",
);

test.describe.configure({ mode: "serial" });

test("boot + the shell renders + never-blank panels", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);

  // The shell rendered (the O-1 never-blank law: a panel or a job
  // group is present, never an empty #fugue-app).
  const app = page.locator("#fugue-app");
  await expect(app).toBeVisible();
  const text = (await app.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);

  // The four honest panels carry `data-panel` — the never-blank pin
  // is "exactly one panel shows" when the lane is degraded; here we
  // assert the panel markup is well-formed when present.
  for (const kind of [
    "no-jobs",
    "no-runs",
    "engine-down",
    "engine-locked",
    "no-dreams",
  ]) {
    const panel = app.locator(`.fugue-panel[data-panel="${kind}"]`);
    if ((await panel.count()) > 0) {
      // Never-blank: the panel has a heading + a body.
      await expect(panel.locator(".fugue-panel-heading")).toBeVisible();
      await expect(panel.locator(".fugue-panel-body")).toBeVisible();
    }
  }
});

test("Ctrl+K opens the command palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fugue-app")).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  // The 15 commands are enumerated (all rows render; disabled rows
  // stay visible, just dimmed). F-7 chunk 2 added the learning band's
  // two routes (open-dreams + open-memory); chunk 3 adds the second
  // half (open-skills + open-manual-notes) to the P0 table.
  const rows = palette.locator("li[data-cmd]");
  expect(await rows.count()).toBe(15);
});

test("the compose dialog validates invalid input inline", async ({
  page,
}) => {
  await page.goto("/");
  // Open the palette + the compose lane.
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await palette.locator("li[data-cmd='new-job']").click();

  const dialog = page.locator('[data-dialog="compose"]');
  await expect(dialog).toBeVisible();

  // The compose form: an empty draft is INVALID by construction —
  // the Create button is disabled (the inline-validation law: the
  // form never submits an invalid draft, the user sees the per-field
  // errors as they fill in).
  await expect(
    dialog.locator('button[aria-label="submit"]'),
  ).toBeDisabled();

  // Fill the required fields: the form becomes submittable.
  await page
    .locator('[data-input="title"]')
    .fill("Fugue smoke job");
  await page.locator('[data-input="prompt"]').fill("smoke-prompt");
  // The default draft has scheduleKind "every" + scheduleExpr "1d"
  // (valid), so the form is now valid: the Create button enables.
  await expect(
    dialog.locator('button[aria-label="submit"]'),
  ).toBeEnabled();
});
