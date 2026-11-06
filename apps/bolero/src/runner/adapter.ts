/**
 * Bolero runner — the narrow adapter port (PLAN §1 boundary, §6 fixture
 * law; the Chaconne `PageAdapter` seam re-adopted for Bolero's
 * watch-spec input).
 *
 * `PageAdapter` is the WHOLE surface the executor needs to run a
 * frozen 9-kind recipe against one page: goto, click, fill, select,
 * wait, assertText, assertElement, extract, screenshot. Two implementors:
 *
 * - `FakeAdapter` — deterministic in-memory DOM table (URL → element
 *   table). Every step kind, every taxonomy entry, the caps and the
 *   committed-prefix law are pinable with NO browser (the §6 unit lane).
 * - `PlaywrightAdapter` — real headless Chromium via the repo root's
 *   `playwright` (the walk-up import ruling, the Chaconne §4
 *   precedent extended to this app: one chromium build for the runner
 *   and the e2e battery — they can never drift). Screenshots are
 *   full-page PNG bytes, content-addressed by the executor.
 *
 * Error contract: a failed step throws `AdapterStepError` carrying a
 * STEP-LEVEL taxonomy status (`step-failed` | `selector-not-found` |
 * `timeout` | `screenshot-failed`). Run-level statuses (`ok`,
 * `invalid-recipe`, `runner-offline`) are decided by the executor,
 * never the adapter. Capped waits NEVER hang: the fake polls on a
 * bounded real-clock timer chain (~20 probes within the cap), the
 * real adapter reserves budget inside every browser wait.
 */

/** A failed step, in the 7-entry status taxonomy's step-level shape. */
export class AdapterStepError extends Error {
  constructor(
    public readonly status:
      | "step-failed"
      | "selector-not-found"
      | "timeout"
      | "screenshot-failed",
    message: string,
  ) {
    super(message);
    this.name = "AdapterStepError";
  }
}

/** A screenshot result: PNG bytes (the real lane) or deterministic
 *  bytes (the fake lane — stable per URL, so the sha256 pin holds). */
export type ScreenshotResult = {
  bytes: Uint8Array;
};

/** The narrow port: the executor's entire view of a page. */
export type PageAdapter = {
  goto(url: string, capMs: number): Promise<void>;
  click(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /** fill + POST-FILL VERIFICATION: read the value back; a silent
   *  mismatch is `step-failed`, never a false ok (the #43 law). */
  fill(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void>;
  select(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void>;
  /** presence of the selector within capMs (`selector-not-found` on a
   *  miss that can never change; `timeout` when the budget is spent). */
  wait(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /** assert-text: `=~` prefix is a CONTAINS match, else EXACT (trimmed). */
  assertText(selector: string, expected: string, capMs: number, intoFrame?: string): Promise<void>;
  /** selector resolves to an element within capMs. */
  assertElement(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /** textContent (or the named attribute when `attr` is set). */
  extract(selector: string, capMs: number, intoFrame?: string, attr?: string): Promise<string>;
  /** full-page capture (the tall-page edge case). */
  screenshot(capMs: number): Promise<ScreenshotResult>;
  /** runner-core extension point — no-op on the fake. */
  close?(): Promise<void>;
};

/* ------------------------------------------------------------------ */
/* FakeAdapter — the deterministic unit lane (in-memory DOM table)     */
/* ------------------------------------------------------------------ */

/** A mutable fake element. */
export type FakeElement = {
  selector: string;
  /** textContent (assert-text / extract). */
  text: string;
  /** attribute map (extract with attr). */
  attrs: Record<string, string>;
  /** current input value (fill/select verification reads this). */
  value?: string;
  /** if set, fill() lands this DIFFERENT value here — the silent-
   *  corruption hook pinning the post-fill-verification law. */
  fillCorrupt?: string;
  /** if set, fill() lands NOTHING (the #43 race simulation). */
  fillNoop?: boolean;
  present: boolean;
  clickable: boolean;
  /**
   * Real-clock wall timestamp (ms epoch); the element is ABSENT until
   * the clock passes it (the slow.html kin). Tests set it to
   * Date.now() + N for a ~Nms-later element.
   */
  appearsAt?: number;
};

/** A fixture factory: one element table per URL (the Chaconne shape). */
export type FakeDomBuilder = (url: string) => { elements: Record<string, FakeElement> };

export type FakeAdapterOptions = {
  dom: FakeDomBuilder;
  /** screenshot bytes; defaults to a deterministic byte stream per URL. */
  screenshotBytes?: (url: string) => Uint8Array;
};

/**
 * The deterministic fake. Frame elements live in the SAME table under
 * the key `${frame}::${selector}` when `intoFrame` is set (mirroring
 * the real adapter's frame resolution, without a browser).
 */
export class FakeAdapter implements PageAdapter {
  private currentUrl = "";
  private urlTables: Map<string, Record<string, FakeElement>> = new Map();
  /** observed fill/select sequence (log-honesty pin). */
  readonly valueLog: string[] = [];

  constructor(private readonly opts: FakeAdapterOptions) {}

  /** The current URL (test hook). */
  get url(): string {
    return this.currentUrl;
  }

  /** Deterministic screenshot bytes: 32 bytes, URL-dependent — stable
   *  per fixture, so a sha256 pin on them is byte-stable. */
  static defaultBytes(url: string): Uint8Array {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = (h >>> ((i % 4) * 8)) & 0xff;
    return out;
  }

  private elementsFor(url: string): Record<string, FakeElement> {
    // STABLE table per URL: the fake's mutations (click flips
    // clickable, fill lands a value) persist for the adapter's life.
    let t = this.urlTables.get(url);
    if (t === undefined) {
      // An unknown URL gets an empty table, so a typo'd fixture URL
      // surfaces as selector-not-found, not a crash.
      const built = this.opts.dom(url);
      t = built?.elements ?? {};
      this.urlTables.set(url, t);
    }
    return t;
  }

  private resolve(selector: string, intoFrame?: string): FakeElement | undefined {
    const key = intoFrame ? `${intoFrame}::${selector}` : selector;
    const els = this.elementsFor(this.currentUrl || "about:blank");
    let el: FakeElement | undefined = els[key];
    if (!el && intoFrame) el = els[selector]; // also exists top-level
    if (el && el.appearsAt !== undefined && Date.now() < el.appearsAt) return undefined;
    if (el && !el.present) return undefined;
    return el;
  }

  private findOrThrow(selector: string, capMs: number, intoFrame?: string): FakeElement {
    const el = this.resolve(selector, intoFrame);
    if (el) return el;
    throw new AdapterStepError(
      "selector-not-found",
      `selector not found: ${intoFrame ? `frame "${intoFrame}" > ` : ""}${selector} (cap ${capMs}ms)`,
    );
  }
  /**
   * Bounded capped poll (the operator ruling): a SINGLE real-clock
   * setTimeout chain, one probe every `max(25, capMs/20)` ms,
   * hard-stopped at `capMs` (~20 probes, never a tight loop). An
   * absent element with no time-gated twin is a `selector-not-found`
   * miss, NEVER a hang (the failure-path fixture law).
   */
  private async cappedWait(fn: () => boolean, capMs: number, canChange: () => boolean): Promise<void> {
    if (fn()) return;
    if (!canChange()) {
      throw new AdapterStepError("selector-not-found", `wait: selector not found within ${capMs}ms`);
    }
    const start = Date.now();
    const interval = Math.max(25, Math.floor(capMs / 20));
    const maxProbes = Math.ceil(capMs / interval) + 1;
    let probes = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: AdapterStepError): void => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      const tick = (): void => {
        if (settled) return;
        probes += 1;
        if (fn()) return finish();
        if (probes >= maxProbes || Date.now() - start >= capMs || !canChange()) {
          return finish(new AdapterStepError("timeout", `wait expired after ${capMs}ms`));
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  async goto(url: string, capMs: number): Promise<void> {
    void capMs; // the fake resolves instantly; the cap is the executor's
    if (url === "") throw new AdapterStepError("step-failed", "goto: empty URL");
    this.currentUrl = url;
    this.urlTables.delete(url); // the goto boundary — a fresh page
    this.elementsFor(url);
  }

  async click(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    if (!el.clickable) {
      throw new AdapterStepError("step-failed", `click: element ${selector} is not clickable`);
    }
    el.clickable = false; // the fake's click has an effect: once-clickable
  }

  async fill(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    this.valueLog.push(value);
    const landValue = el.fillNoop ? undefined : el.fillCorrupt !== undefined ? el.fillCorrupt : value;
    el.fillCorrupt = undefined; // cleared after read — stable-table law
    el.fillNoop = undefined;
    el.value = landValue;
    // POST-FILL VERIFICATION: read the value back; a silent mismatch
    // is a step failure, never a false ok.
    if (el.value !== value) {
      throw new AdapterStepError(
        "step-failed",
        `fill verification failed on ${selector}: expected ${JSON.stringify(value)}, read back ${JSON.stringify(el.value)}`,
      );
    }
  }

  async select(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    this.valueLog.push(value);
    el.value = value;
    if (el.value !== value) {
      throw new AdapterStepError("step-failed", `select verification failed on ${selector}`);
    }
  }

  async wait(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    const found = () => this.resolve(selector, intoFrame) !== undefined;
    const canChange = (): boolean => {
      const key = intoFrame ? `${intoFrame}::${selector}` : selector;
      const els = this.elementsFor(this.currentUrl || "about:blank");
      return Object.values(els).some((e) => {
        const k = intoFrame ? `${intoFrame}::${e.selector}` : e.selector;
        return k === key && e.appearsAt !== undefined && Date.now() < e.appearsAt;
      });
    };
    await this.cappedWait(found, capMs, canChange);
  }

  async assertText(selector: string, expected: string, capMs: number, intoFrame?: string): Promise<void> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    const matched = expected.startsWith("=~")
      ? el.text.includes(expected.slice(2))
      : el.text === expected;
    if (!matched) {
      throw new AdapterStepError(
        "step-failed",
        `assert-text ${selector}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(el.text)}`,
      );
    }
  }

  async assertElement(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    this.findOrThrow(selector, capMs, intoFrame);
  }

  async extract(selector: string, capMs: number, intoFrame?: string, attr?: string): Promise<string> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    const value = attr !== undefined ? el.attrs[attr] : el.text;
    if (value === undefined) {
      throw new AdapterStepError(
        "step-failed",
        `extract ${attr !== undefined ? `${attr} of ${selector}` : selector}: no value found`,
      );
    }
    return value;
  }

  async screenshot(capMs: number): Promise<ScreenshotResult> {
    void capMs;
    const url = this.currentUrl || "about:blank";
    const bytes = this.opts.screenshotBytes?.(url) ?? FakeAdapter.defaultBytes(url);
    return { bytes };
  }
}

/* ------------------------------------------------------------------ */
/* PlaywrightAdapter — the real-lane implementor (Chromium, root dep)  */
/* ------------------------------------------------------------------ */

import { chromium } from "playwright";
import type { Page, Frame, Locator } from "playwright";

/**
 * The 500ms reservation on every capped Playwright wait: when the
 * caller hands us a `capMs` budget, the browser call gets
 * `capMs - RESERVE` — if the browser times out at that, OUR code still
 * has budget left to translate it into the taxonomy entry (never a
 * hang past the step's budget).
 */
const RESERVE_MS = 500;

/** The real-adapter factory (one fresh headless Chromium per run). */
export async function makePlaywrightAdapter(): Promise<PageAdapter> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const adapter = new PlaywrightAdapter(page);
  adapter.close = async () => {
    await browser.close();
  };
  return adapter;
}

/**
 * The real adapter. Wraps a Playwright Page; screenshots are full-page
 * PNG bytes (the tall-page edge case — no scroll flake). Dependency
 * ruling: this file imports `playwright` by bare specifier — Bun
 * resolves it by walking UP from `apps/bolero/src/runner/` to the
 * repo root's `node_modules` (the walk-up ruling, the Chaconne §4
 * precedent).
 */
export class PlaywrightAdapter implements PageAdapter {
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
        // POST-FILL VERIFICATION: read the value back and require
        // equality — a race that lost the value fails the step.
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
          throw new AdapterStepError("step-failed", `select verification failed on ${selector}`);
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

  async screenshot(capMs: number): Promise<ScreenshotResult> {
    void capMs; // a full-page capture is bounded by the run's wall cap
    try {
      // fullPage: the page may be taller than the viewport (the tall-
      // page edge case); Playwright captures the whole scrollable
      // region, no scroll flake.
      const bytes = await this.page.screenshot({ fullPage: true });
      return { bytes: new Uint8Array(bytes) };
    } catch (e) {
      throw new AdapterStepError("screenshot-failed", `screenshot: ${(e as Error).message}`);
    }
  }

  close?: () => Promise<void>;

  /* — error classification (the Playwright message shapes) — */

  private isNotFound(e: unknown): boolean {
    const m = (e as Error)?.message ?? String(e);
    // Playwright's missing-selector paths all report waiting for the
    // selector; a found-but-not-visible element is a step-failed, not
    // a missing selector.
    return /waiting for locator\([^)]*\)/.test(m);
  }

  private isTimeout(e: unknown): boolean {
    const m = (e as Error)?.message ?? String(e);
    return m.startsWith("Timeout") && !this.isNotFound(e);
  }
}
