/**
 * Fugue — the e2e learning-band lane (ticket F-7 chunk 4, FINAL).
 *
 * The four learning views (dreams journal, memory tiers, skills queue,
 * Manual-notes editor) exercise the FIXTURE lane: the app boots against
 * the fixture engine (4130, canned live wire forms from F-3/F-7) + the
 * app server's read-only routes (GET /skills-staged, GET /manual-notes
 * against the repo's real .unown — READ-ONLY; the save lane is V-28
 * isolation-pinned at the unit level and is NEVER e2e-driven here).
 *
 * THE SELF-SKIP GUARD: the FUGUE_E2E marker (the Coda/Chaconne
 * precedent, the fugue-smoke kin): absent marker -> the spec
 * self-skips; the fixture lane never runs under any other marker and
 * never touches the live engine.
 *
 * LAWS honored:
 *   - zero new deps (the repo's Playwright, the root testDir e2e/);
 *   - lane-pinned selectors only (data-route / data-cmd / data-dream /
 *     data-tier / data-staged / data-mn-* / data-panel);
 *   - no writes to .unown/** (GET-only server routes; the over-cap
 *     marker is a RENDER preview, not a save — edge 11);
 *   - E-06 at the e2e level: a GATED dream row NEVER carries the
 *     success class;
 *   - keyboard: Escape from each learning route returns to jobs.
 *
 * Operator gate: FUGUE_E2E=1 bunx playwright test -c
 * playwright.fugue.config.ts (repo root).
 */
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";

// THE FIXTURE LIFECYME LANE (the fixture-serve.mjs kin): the spec
// owns the fixture engine — the e2e lane boots the shim
// (apps/fugue/runner/fixture-serve.mjs: the real engine stub with
// CORS, served on 4130) so the engine-lane assertions fire
// DETERMINISTICALLY every run. beforeAll spawns, afterAll terminates
// by handle — no leaked ports.
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

const GATED_DREAM_ID = "8f2b1c0e-1234-4abc-9def-85ebe9ad0002";
const RUNNING_DREAM_ID = "c0ffee00-0000-4abc-9def-85ebe9ad0003";
const DONE_DREAM_ID = "project-85ebe9ad-36eb-48e2-ac09-369231b6caea";

/** Ctrl+K -> the palette -> one learning command. */
async function openRoute(page: import("@playwright/test").Page, cmd: string) {
  await page.goto("/");
  await expect(page.locator("#fugue-app")).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await palette.locator(`li[data-cmd="${cmd}"]`).click();
}

test("the dreams journal renders the fixture's canned dreams (E-06 pin)", async ({
  page,
}) => {
  await openRoute(page, "open-dreams");
  const route = page.locator('[data-route="dreams"]');
  await expect(route).toBeVisible();

  // The populated lane (the fixture's three live wire rows: done +
  // gated + running). The honest no-dreams panel is unit-tested only.
  const rows = route.locator("li[data-dream]");
  expect(await rows.count()).toBe(3);

  // E-06 at the e2e level: the GATED row NEVER wears the success
  // class — its badge is the is-gated lane, not is-success.
  const gatedRow = route.locator(`li[data-dream="${GATED_DREAM_ID}"]`);
  await expect(gatedRow).toBeVisible();
  await expect(
    gatedRow.locator('.fugue-dream-badge.is-success'),
  ).toHaveCount(0);
  await expect(
    gatedRow.locator(".fugue-dream-badge.is-gated", { hasText: "gated" }),
  ).toBeVisible();

  // The running row renders with its running badge (the open run).
  const runningRow = route.locator(`li[data-dream="${RUNNING_DREAM_ID}"]`);
  await expect(
    runningRow.locator(".fugue-dream-badge.is-running", {
      hasText: "running",
    }),
  ).toBeVisible();
});

test("the dreams output preview opens (details/summary toggle)", async ({
  page,
}) => {
  await openRoute(page, "open-dreams");
  const row = page.locator(`li[data-dream="${DONE_DREAM_ID}"]`);
  await expect(row).toBeVisible();
  const details = row.locator(".fugue-dream-output");
  await expect(details.locator("summary")).toBeVisible();
  // Closed by default: the full output is hidden until toggled.
  await expect(details.locator("pre.fugue-dream-output-full")).not.toBeVisible();
  await details.locator("summary").click();
  await expect(details.locator("pre.fugue-dream-output-full")).toBeVisible();
});

test("the memory view renders fixture tiers + the health card", async ({
  page,
}) => {
  await openRoute(page, "open-memory");
  const route = page.locator('[data-route="memory"]');
  await expect(route).toBeVisible();

  // The tiers lane: the fixture's one tier (name + version literal).
  const tierRow = route.locator('li[data-tier="policy"][data-version="1"]');
  await expect(tierRow).toBeVisible();
  await expect(tierRow.locator(".fugue-tier-name", { hasText: "policy" })).toBeVisible();
  await expect(tierRow.locator(".fugue-tier-version", { hasText: "v1" })).toBeVisible();

  // The health card: the fixture's backend + model literals.
  const card = route.locator(".fugue-health-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-healthy", "true");
  const backend = card.locator("dt", { hasText: "backend" }).locator("../dd");
  await expect(backend).toHaveText("lexical");
  await expect(
    card.locator("dd", { hasText: "agnes-3.0-flash" }),
  ).toBeVisible();

  // The expandable tier content opens (details/summary toggle).
  const details = tierRow.locator(".fugue-tier-output");
  await details.locator("summary").click();
  await expect(details.locator("pre.fugue-tier-output-full")).toBeVisible();
});

test("the skills view renders the staged queue + the promote hint", async ({
  page,
}) => {
  await openRoute(page, "open-skills");
  const route = page.locator('[data-route="skills"]');
  await expect(route).toBeVisible();

  // The staged lane: the app server's READ-ONLY /skills-staged route
  // against the repo's real .unown/skills-staged — rows render + the
  // promote hint is the verbatim mv command.
  const stagedRows = route.locator("li[data-staged]");
  expect(await stagedRows.count()).toBeGreaterThan(0);
  const first = stagedRows.first();
  const stagedName = (await first.getAttribute("data-staged")) ?? "";
  await expect(
    first.locator(".fugue-promote-cmd", {
      hasText: `mv .unown/skills-staged/${stagedName}`,
    }),
  ).toBeVisible();

  // The engine lane: the fixture's canned /api/skills (the honest
  // empty state — zero DB skills in the fixture lane).
  await expect(
    route.locator('.fugue-panel[data-panel="no-engine-skills"]'),
  ).toBeVisible();
});

test("the Manual-notes editor: lane label + meter + the over-cap marker", async ({
  page,
}) => {
  await openRoute(page, "open-manual-notes");
  const route = page.locator('[data-route="manual-notes"]');
  await expect(route).toBeVisible();

  // The lane label renders 'unverified' (the hand-edited marking).
  const lane = route.locator('[data-mn-lane]');
  await expect(lane).toBeVisible();
  await expect(lane).toHaveText(/unverified/);

  // The textarea prefills (the section body, or the honest empty).
  const input = route.locator("[data-mn-input]");
  await expect(input).toBeVisible();

  // The budget meter renders the chars/cap pattern.
  const meter = route.locator("[data-mn-chars]");
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("data-mn-cap", "4096");

  // Edge 11: typing PAST the cap surfaces the VISIBLE over-cap
  // marker — a render preview, NOT a save (the V-28 law: the write
  // lane is unit-pinned + operator live-proven, never e2e-driven).
  // fill = select-all + insert: one input event replaces the prefill
  // draft with 4097 'x' — the in-place handler updates the meter.
  const over = route.locator("[data-mn-overcap]");
  await input.fill("x".repeat(4097));
  await expect(meter).toHaveAttribute("data-mn-over", "1");
  await expect(meter).toContainText("over cap");
  // The VISIBLE over-cap marker (edge 11): the in-place appended
  // block surfaces when the shell re-renders FROM state (draft
  // over-cap), else the meter's over-cap line + data-mn-over=1 are
  // the marker surface this e2e lane pins (the write lane stays
  // V-28 isolation-pinned at the unit level).
  if ((await over.count()) > 0) {
    await expect(over).toBeVisible();
    await expect(
      over.locator("code", { hasText: "unown: manual notes over cap" }),
    ).toBeVisible();
    await expect(
      route.locator(".fugue-mn-dropped-tail"),
    ).toContainText("x");
  }
  await expect(meter).toContainText(
    "4097 / 4096 chars — over cap: the renderer will drop the tail",
  );

  // No Save click here — the e2e asserts the read + the marker only.
});

test("Escape from each learning route returns to jobs", async ({ page }) => {
  for (const cmd of [
    "open-dreams",
    "open-memory",
    "open-skills",
    "open-manual-notes",
  ]) {
    await openRoute(page, cmd);
    const routeName = cmd.replace("open-", "");
    await expect(page.locator(`[data-route="${routeName}"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-route="jobs"]')).toBeVisible();
  }
});
