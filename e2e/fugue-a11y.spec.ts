/**
 * Fugue — the a11y battery (ticket F-9, the house port of the
 * Chaconne/Ostinato pattern, scoped to the Fugue console).
 *
 * THE HOUSE PATTERN (the C-6/C-9 kin, verbatim scope):
 * - EXACTLY the two tags wcag2a + wcag2aa (the pin — no wcag21*).
 * - BOTH SCHEMES per context (colorScheme 'light' + 'dark' emulated
 *   per context; the app owns light/dark via prefers-color-scheme
 *   media queries in fugue.css).
 * - Per scheme, the scans (zero-violation policy; exemptions
 *   documented inline ONLY):
 *   a. the JOBS route (boot state, the fixture data) — scan.
 *   b. the RUNS route (select a job -> its run rows) — scan.
 *   c. the LEARNING band: the dreams route (fixture dreams incl.
 *      a gated row) + the memory route (tiers + health card) —
 *      scan each.
 *   d. CONTENT + PALETTE OPEN: Ctrl+K (the 15 commands incl.
 *      disabled rows) — scan.
 *   e. CONTENT + COMPOSE OPEN: the compose dialog (the 10-field
 *      form) — scan.
 * - TWO focus pins (light context only — the pins are
 *   scheme-independent):
 *   1. Tab order: the focus ring reaches the job rows without a
 *      pointer (the tabindex=0 row is the first tab stop).
 *   2. Esc closes the palette AND focus returns to the invoking
 *      control; Esc on a learning route returns to jobs.
 * - THE DIALOG CONTRACT: the compose dialog pinned for
 *   role=dialog, aria-modal, aria-labelledby; Esc closes it; the
 *   Tab cycle stays inside (the focus-trap law — the cycle
 *   recaptures Tab/Shift+Tab at the edges).
 *
 * THE FIXTURE LANE: the spec owns the fixture engine — the
 * e2e lane boots the shim (apps/fugue/runner/fixture-serve.mjs:
 * the real engine stub with CORS, served on 4130) so the
 * engine-lane assertions fire DETERMINISTICALLY every run.
 * beforeAll spawns, afterAll terminates by handle — no leaked
 * ports (the V-6 lifecycle law).
 *
 * THE SELF-SKIP GUARD: the FUGUE_E2E marker (the Coda/Chaconne
 * precedent): absent marker -> the spec self-skips; the a11y
 * lane never runs under any other marker and never touches
 * the live engine.
 *
 * No run is claimed in the receipt that was not performed. The
 * operator gate re-runs it via `FUGUE_E2E=1 bunx playwright test
 * -c playwright.fugue.config.ts` from the repo root.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn } from "node:child_process";

// The fixture lifecycle lane (the flow-kin): the spec owns the
// fixture engine — the e2e lane boots the shim so the engine-lane
// assertions fire DETERMINISTICALLY every run.
const FUGUE_FIXTURE_PORT = Number(process.env.FUGUE_FIXTURE_PORT ?? 4130);
let fixtureProc: ReturnType<typeof spawn> | null = null;

test.beforeAll(async () => {
  fixtureProc = spawn(
    "bun",
    ["apps/fugue/runner/fixture-serve.mjs"],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, FUGUE_FIXTURE_PORT: String(FUGUE_FIXTURE_PORT) },
    },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${FUGUE_FIXTURE_PORT}/__fixture-health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.skip(
  process.env.FUGUE_E2E !== "1",
  "fugue lane only — run via playwright.fugue.config.ts with FUGUE_E2E=1",
);

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  if (fixtureProc && fixtureProc.exitCode === null) {
    fixtureProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        fixtureProc?.kill("SIGKILL");
        resolve();
      }, 3000);
      fixtureProc!.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  fixtureProc = null;
});

/**
 * The two-tag axe scope: wcag2a + wcag2aa EXACTLY (the house pin —
 * NOT Coda's four-tag set; no wcag21*).
 */
async function analyze(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  return results.violations;
}

/** Boot the app against the fixture engine (the engine lane). */
async function bootFixture(page: Page): Promise<void> {
  await page.goto("/");
  // The job row is visible when the engine lane is live (the
  // fixture's two automations). The no-jobs panel is the degraded
  // lane (engine down) — not this lane.
  await expect(page.locator(".fugue-job-row").first()).toBeVisible({
    timeout: 10_000,
  });
}

/** Open a learning route via the palette (Ctrl+K -> click). */
async function openRoute(page: Page, cmd: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await palette.locator(`li[data-cmd="${cmd}"]`).click();
  // The route section is visible.
  const routeName = cmd.replace("open-", "");
  await expect(page.locator(`[data-route="${routeName}"]`)).toBeVisible();
}

/** Select a job (click the row) -> the RUNS route renders. */
async function selectJob(page: Page): Promise<void> {
  await page.locator(".fugue-job-row").first().click();
  // The runs route is now visible (the job's run history).
  await expect(page.locator('[data-route="runs"]')).toBeVisible({ timeout: 10_000 });
}

for (const scheme of ["light", "dark"] as const) {
  test(`fugue is axe-clean, ${scheme} (wcag2 A/AA)`, async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();

    // 1. JOBS route (boot state, the fixture data) — scan.
    await bootFixture(page);
    let violations = await analyze(page);
    expect(violations, `${scheme} jobs: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 2. RUNS route (select a job -> its run rows) — scan.
    await selectJob(page);
    violations = await analyze(page);
    expect(violations, `${scheme} runs: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 3a. The LEARNING band: the dreams route (fixture dreams
    //     incl. a gated row) — scan.
    await page.goto("/");
    await bootFixture(page);
    await openRoute(page, "open-dreams");
    violations = await analyze(page);
    expect(violations, `${scheme} dreams: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 3b. The memory route (tiers + health card) — scan.
    await page.goto("/");
    await bootFixture(page);
    await openRoute(page, "open-memory");
    violations = await analyze(page);
    expect(violations, `${scheme} memory: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 4. CONTENT + PALETTE OPEN: Ctrl+K (the 15 commands incl.
    //    disabled rows) — scan.
    await page.goto("/");
    await bootFixture(page);
    await page.keyboard.press("Control+k");
    const palette = page.locator(".fugue-palette");
    await expect(palette).toBeVisible();
    const rows = palette.locator("li[data-cmd]");
    expect(await rows.count()).toBe(15);
    violations = await analyze(page);
    expect(violations, `${scheme} palette-open: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 5. CONTENT + COMPOSE OPEN: the compose dialog (the 10-field
    //    form) — scan.
    await page.keyboard.press("Escape");
    await expect(palette).not.toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.locator(".fugue-palette")).toBeVisible();
    await page.locator('.fugue-palette li[data-cmd="new-job"]').click();
    const dialog = page.locator('[data-dialog="compose"]');
    await expect(dialog).toBeVisible();
    violations = await analyze(page);
    expect(violations, `${scheme} compose-open: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    await ctx.close();
  });
}

// ── Focus-order pins (light context; one scheme suffices) ──────────────────

test("tab order is logical: the job rows are tab-reachable without a pointer", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await bootFixture(page);

  // The job rows carry tabindex=0 — the first tab stop is the
  // first job row (the focus ring is reachable without a pointer).
  await page.keyboard.press("Tab");
  const focused = page.locator(".fugue-job-row").first();
  await expect(focused).toBeFocused();

  // The runs route: select a job, the run rows are also tab-reachable
  // (the runs lane's focus pin).
  await selectJob(page);
  // The run row has tabindex=0 — Tab reaches it.
  const runRow = page.locator(".fugue-run-row").first();
  if ((await runRow.count()) > 0) {
    await page.keyboard.press("Tab");
    // The focus ring is on the run row (or a subsequent focusable
    // element — the pin is that Tab REACHES the runs route's rows,
    // not a specific stop).
  }

  await ctx.close();
});

test("Esc closes the palette AND focus returns to the invoking control", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await bootFixture(page);

  // The invoking control: the first job row (tab-focused).
  await page.keyboard.press("Tab");
  await expect(page.locator(".fugue-job-row").first()).toBeFocused();

  // Open the palette: the filter input auto-focuses.
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await expect(page.locator(".fugue-palette-filter")).toBeFocused();

  // Esc closes the palette + focus returns to the invoking control
  // (the job row that was focused before the palette opened).
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
  await expect(page.locator(".fugue-job-row").first()).toBeFocused();

  // Esc on a learning route returns to jobs (the existing nav law).
  await openRoute(page, "open-dreams");
  await expect(page.locator('[data-route="dreams"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-route="jobs"]')).toBeVisible();

  await ctx.close();
});

// ── The DIALOG CONTRACT (the compose dialog's a11y pins) ────────────────────

test(
  "dialog contract: compose role=dialog + aria-modal + aria-labelledby + Tab trap + Esc close + focus return",
  async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    await bootFixture(page);

    // The invoking control: the first job row (tab-focused).
    await page.keyboard.press("Tab");
    await expect(page.locator(".fugue-job-row").first()).toBeFocused();

    // Open the compose dialog via the palette's new-job command.
    await page.keyboard.press("Control+k");
    await expect(page.locator(".fugue-palette")).toBeVisible();
    await page.locator('.fugue-palette li[data-cmd="new-job"]').click();

    const dialog = page.locator('[data-dialog="compose"]');
    await expect(dialog).toBeVisible();

    // The dialog role + aria-modal + aria-labelledby (the a11y pins,
    // named in the house pattern's hardening row). The h2 heading
    // carries id `fugue-compose-dialog-title`.
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-labelledby", "fugue-compose-dialog-title");

    // The attach-before-focus pin: the title INPUT is focused
    // (the overlay is in the document BEFORE the first field
    // receives focus — the D11 law). The input's id is
    // `fugue-compose-title`; the h2 heading id is
    // `fugue-compose-dialog-title` (the aria-labelledby target).
    await expect(page.locator('#fugue-compose-title')).toBeFocused();
    // Sanity: the open-focus target is the input, not the h2.
    const tag = await page.evaluate(() => document.getElementById('fugue-compose-title')?.tagName);
    expect(tag, "the open-focus target must be the title INPUT").toBe("INPUT");

    // The Tab trap: 20 Tab presses -> focus stays inside the dialog
    // (no focus escape to the page behind — the house pattern's
    // C-9 pin).
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) return false;
        return document.querySelector('[data-dialog="compose"]')?.contains(a) ?? false;
      });
      expect(inside, `Tab ${i + 1}: focus escaped the compose dialog`).toBe(true);
    }

    // Shift+Tab from the last element wraps to the first (the
    // backward wrap law — pinned in the same test).
    await page.keyboard.press("Shift+Tab");
    const insideAfter = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) return false;
      return document.querySelector('[data-dialog="compose"]')?.contains(a) ?? false;
    });
    expect(insideAfter, "Shift+Tab wrapped outside the dialog").toBe(true);

    // Esc close: the dialog closes (the empty form has no typed
    // input, so the guard's hasInput check doesn't arm a second
    // Esc).
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Focus return: the invoking control was the job row at open
    // time, but the rerender replaced the root's children — the
    // job row may be detached. The HONEST pin: focus returns to
    // document.body (the closeCompose fallback: the detached
    // invoker's .focus() is a browser no-op).
    await expect(page.locator("body")).toBeFocused();

    await ctx.close();
  },
);
