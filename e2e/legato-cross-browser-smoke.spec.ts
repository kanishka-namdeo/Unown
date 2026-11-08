/**
 * Legato — the cross-browser SMOKE lane (ticket L-11, PLAN §3
 * L-11 + §6.4: "legato-cross-browser-smoke.spec.ts — a flagged
 * condition: run under a second engine IF THE LANE ALLOWS; the
 * gap stays a named [U] otherwise (PRD non-goal #3)").
 *
 * THE HONEST CHROMIUM-ONLY SCOPE (the brief's deliverable #4):
 * the `playwright.legato.config.ts` this spec runs under launches
 * Chromium ONLY (the `chromium` project — no WebKit / Firefox
 * projects, the L-10 config's single-engine choice). This spec
 * therefore DOCUMENTS the no-parity claim in this header (the
 * "honest Chromium-only honesty note" the brief names): it is
 * the SMOKE lane, not a cross-browser battery. The WebKit /
 * Firefox full batteries are the P1 backlog (post-freeze, per
 * the PRD + the app's AGENTS.md "P1 backlog" row) — a named
 * [U], never a silent gap.
 *
 * THE ONE SMOKE FLOW (the brief's "runs the one smoke flow"):
 * boot the app in the Chromium context → the empty-state panel
 * renders (Q-3's never-a-blank law) → the service worker
 * registers (the L-10 offline lane's install proof) → the
 * manifest fetches (the P0 installability inventory, the
 * offline spec's P0 lane). No clip pipeline run (the flow spec
 * owns that lane; the smoke is the shell's boot health, the
 * minimal "does the app start" assertion the cross-browser
 * claim would rest on IF a second engine were in the config).
 *
 * Self-skip: the spec runs under the legato config's LEGATO_E2E
 * marker (the Coda/Ostinato/Fugue precedent); under the root
 * config the marker is unset and the spec self-skips.
 *
 * Operator gate: LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts from the repo root. No
 * run is claimed that was not performed.
 */
import { expect, test, type BrowserContext } from "@playwright/test";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

test("cross-browser smoke (Chromium-only lane — WebKit/Firefox parity NOT claimed; the P1 [U])", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // The shell's boot health: the empty panel + the status line's
  // clear (a clean boot, no boot error).
  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText("No clips yet", {
    timeout: 15_000,
  });
  await expect(page.locator("#legato-status")).toHaveText("");

  // The L-10 offline lane's install proof: the SW registers +
  // claims the client (the Ostinato O-4 / Coda main.ts pattern,
  // the offline spec's "boots controlled" lane's ready signal).
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );

  // The P0 installability inventory: the manifest fetches (the
  // shell asset, in the precache).
  const manifestRes = await page.request.get("/public/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);

  await ctx.close();
});
