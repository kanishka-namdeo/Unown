/**
 * Chaconne runner — the real adapter (PLAN §1/§3, the #43/#44 kin).
 *
 * Wraps a real Playwright Page. The two #43-class cures live here:
 *
 * 1. iframe frame resolution for `intoFrame`: find the iframe by
 *    `name` OR `data-testid` on the page, then operate inside its
 *    `Frame` (`frame.locator(...).fill(...)` — the frame hosts the field,
 *    the top page does not).
 * 2. POST-FILL VERIFICATION: after every fill/select, read the value
 *    back (`inputValue()`) and require it to EQUAL the intended value —
 *    a silently-raced fill (the #43 defect) fails the step instead of
 *    surfacing as ok.
 *
 * Capped waits: every Playwright `waitFor*` call gets `capMs - RESERVE`
 * so that when the browser's timeout fires, this code still has
 * RESERVE ms left to translate it into the taxonomy error. A capped
 * wait NEVER hangs past the step's budget (PRD edge case 2).
 *
 * Screenshots use `{ fullPage: true }` (edge case 4 — a page taller
 * than the viewport is captured whole, no scroll flake).
 *
 * Dependency ruling (PLAN §4 option (a)): this file lives under
 * `apps/chaconne/runner/` and imports `playwright` by bare specifier —
 * Bun resolves it by walking UP from this dir to the repo root's
 * `node_modules` (root devDependency; one version shared with the e2e
 * lane). If resolution breaks, the CLI FAILS LOUDLY (bare-specifier
 * error), which is the C-2 verifier's contract.
 */
import { chromium } from "playwright";
import type { Page, Frame, Locator } from "playwright";
import { AdapterStepError, type PageAdapter, type ScreenshotResult } from "./page-adapter.js";

/**
 * The 500ms reservation on every capped Playwright wait: when the
 * caller hands us a `capMs` budget, the browser call gets
 * `capMs - RESERVE` — if the browser times out at that, OUR code still
 * has budget left to surface the taxonomy entry (never a hang).
 */
const RESERVE_MS = 500;

/** The real-adapter factory (one fresh headless Chromium per run). */
export async function makeRealAdapter(): Promise<PageAdapter> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const adapter = new RealPageAdapter(page);
  adapter.close = async () => {
    await browser.close();
  };
  return adapter;
}

class RealPageAdapterImpl implements PageAdapter {
  private frame?: Frame;

  constructor(private readonly page: Page) {}

  /** The Page or the last-resolved Frame the operation runs in. */
  private host(name?: string): Page | Frame {
    return name !== undefined ? this.frame ?? this.page : this.page;
  }

  /**
   * Resolve an `intoFrame` name: an iframe on the TOP page whose `name`
   * or `data-testid` matches. Capped — a missing iframe surfaces as
   * selector-not-found within the budget, never hangs.
   */
  private async resolveFrame(name: string, capMs: number): Promise<void> {
    const sel = `iframe[name="${name}"], iframe[data-testid="${name}"]`;
    try {
      const loc = this.page.locator(sel);
      await loc.first().waitFor({ state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
      const handle = await loc.first().elementHandle();
      if (!handle) throw new AdapterStepError("selector-not-found", `intoFrame "${name}": no element handle`);
      const frame = await handle.contentFrame();
      if (!frame) throw new AdapterStepError("selector-not-found", `intoFrame "${name}": not a frame`);
      this.frame = frame;
    } catch (e) {
      if (e instanceof AdapterStepError) throw e;
      if (this.isTimeout(e)) throw new AdapterStepError("timeout", `intoFrame "${name}": expired within cap`);
      throw new AdapterStepError("selector-not-found", `intoFrame "${name}": iframe not found on page`);
    }
  }

  private async withFrame<T>(intoFrame: string | undefined, capMs: number, fn: (host: Page | Frame) => Promise<T>): Promise<T> {
    if (intoFrame !== undefined) {
      this.frame = undefined; // resolve per call — the frame is not cached across steps
      await this.resolveFrame(intoFrame, capMs);
      return fn(this.frame!);
    }
    return fn(this.page);
  }

  async goto(url: string, capMs: number): Promise<void> {
    try {
      await this.page.goto(url, { timeout: Math.max(1, capMs - RESERVE_MS) });
      this.frame = undefined;
    } catch (e) {
      if (this.isTimeout(e)) throw new AdapterStepError("timeout", `goto ${url}: expired within cap`);
      throw new AdapterStepError("step-failed", `goto ${url}: ${(e as Error).message}`);
    }
  }

  async click(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.withFrame(intoFrame, capMs, async (host) => {
      try {
        const loc: Locator = host.locator(selector).first();
        await loc.waitFor({ state: "visible", timeout: Math.max(1, capMs - RESERVE_MS) });
        await loc.click({ timeout: RESERVE_MS });
      } catch (e) {
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `click: ${selector}`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `click: ${selector}`);
        throw new AdapterStepError("step-failed", `click ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async fill(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.withFrame(intoFrame, capMs, async (host) => {
      const loc: Locator = host.locator(selector).first();
      try {
        await loc.waitFor({ state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
        await loc.fill(value, { timeout: RESERVE_MS });
        // POST-FILL VERIFICATION (#43 cure, PLAN §3): read the value
        // back and require equality — a race that lost the value fails
        // the step, it never surfaces as ok.
        const readBack = await loc.inputValue({ timeout: RESERVE_MS });
        if (readBack !== value) {
          throw new AdapterStepError(
            "step-failed",
            `fill verification failed on ${selector}: expected ${JSON.stringify(value)}, read back ${JSON.stringify(readBack)}`,
          );
        }
      } catch (e) {
        if (e instanceof AdapterStepError) throw e;
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `fill: ${selector}`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `fill: ${selector}`);
        throw new AdapterStepError("step-failed", `fill ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async select(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.withFrame(intoFrame, capMs, async (host) => {
      const loc: Locator = host.locator(selector).first();
      try {
        await loc.waitFor({ state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
        await loc.selectOption({ value }, { timeout: RESERVE_MS });
        // Parity: a select lands too — verify the option took.
        const selected = await loc.inputValue({ timeout: RESERVE_MS }).catch(() => undefined);
        if (selected !== undefined && selected !== value) {
          throw new AdapterStepError(
            "step-failed",
            `select verification failed on ${selector}: expected ${JSON.stringify(value)}, read back ${JSON.stringify(selected)}`,
          );
        }
      } catch (e) {
        if (e instanceof AdapterStepError) throw e;
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `select: ${selector}`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `select: ${selector}`);
        throw new AdapterStepError("step-failed", `select ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async wait(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.withFrame(intoFrame, capMs, async (host) => {
      try {
        await host.waitForSelector(selector, { state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
      } catch (e) {
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `wait: ${selector} not found within cap`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `wait: ${selector} expired within cap`);
        throw new AdapterStepError("step-failed", `wait ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async assertText(selector: string, expected: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.withFrame(intoFrame, capMs, async (host) => {
      const loc: Locator = host.locator(selector).first();
      try {
        await loc.waitFor({ state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
        const text = (await loc.textContent({ timeout: RESERVE_MS })) ?? "";
        if (text.trim() !== expected.trim()) {
          throw new AdapterStepError(
            "step-failed",
            `assert-text ${selector}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`,
          );
        }
      } catch (e) {
        if (e instanceof AdapterStepError) throw e;
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `assert-text: ${selector}`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `assert-text: ${selector}`);
        throw new AdapterStepError("step-failed", `assert-text ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async assertElement(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    await this.wait(selector, capMs, intoFrame);
  }

  async extract(selector: string, capMs: number, intoFrame?: string, attr?: string): Promise<string> {
    return await this.withFrame(intoFrame, capMs, async (host) => {
      const loc: Locator = host.locator(selector).first();
      try {
        await loc.waitFor({ state: "attached", timeout: Math.max(1, capMs - RESERVE_MS) });
        const value = attr !== undefined
          ? await loc.getAttribute(attr, { timeout: RESERVE_MS })
          : (await loc.textContent({ timeout: RESERVE_MS })) ?? "";
        if (value === null) {
          throw new AdapterStepError("step-failed", `extract ${attr !== undefined ? `${attr} of ${selector}` : selector}: attribute not set`);
        }
        return value;
      } catch (e) {
        if (e instanceof AdapterStepError) throw e;
        if (this.isNotFound(e)) throw new AdapterStepError("selector-not-found", `extract: ${selector}`);
        if (this.isTimeout(e)) throw new AdapterStepError("timeout", `extract: ${selector}`);
        throw new AdapterStepError("step-failed", `extract ${selector}: ${(e as Error).message}`);
      }
    });
  }

  async screenshot(_capMs: number): Promise<ScreenshotResult> {
    // fullPage: the page may be taller than the viewport (edge 4);
    // Playwright captures the whole scrollable region, no scroll flake.
    const bytes = await this.page.screenshot({ fullPage: true });
    return { bytes };
  }

  close?: () => Promise<void>;

  /* — error classification — */

  private isNotFound(e: unknown): boolean {
    const m = (e as Error)?.message ?? String(e);
    // Playwright's missing-selector paths all report waiting for the
    // selector (strict-mode / zero-match); a found-but-not-visible
    // element reports "element not visible" — that is a step-failed,
    // not a missing selector.
    return /waiting for locator\([^)]*\)/.test(m);
  }

  private isTimeout(e: unknown): boolean {
    const m = (e as Error)?.message ?? String(e);
    return m.startsWith("Timeout") && !this.isNotFound(e);
  }
}

export const RealPageAdapter = RealPageAdapterImpl;
export { makeRealAdapter as RealPageAdapterLaunch };
