/**
 * Chaconne runner — the PageAdapter seam (PLAN §1/§3).
 *
 * `PageAdapter` is the whole surface the runner core needs to execute a
 * recipe: goto, click, fill, select, wait, assertText, assertElement,
 * extract, screenshot. Two implementors:
 *
 * - `RealPageAdapter` (real-adapter.ts) — a real Playwright Page; the
 *   iframe / post-fill-verification / fullPage behavior lives there.
 * - `FakePageAdapter` — an in-memory DOM table (URL → element/value
 *   maps) making every step kind, every error-taxonomy entry, the caps
 *   and the committed-prefix law deterministic with NO browser (the §3
 *   runner-unit strategy).
 *
 * Error contract: a failed step throws `AdapterStepError` with a
 * taxonomy status (`step-failed` | `selector-not-found` | `timeout` —
 * the run-level `invalid-recipe` and `ok` are decided by the runner
 * core, not by the adapter). A capped wait NEVER hangs: the fake polls
 * on a bounded real-clock timer chain (at most ~20 probes within the
 * step's cap), and the real adapter's browser waits reserve budget.
 */

/** A failed step, in error-taxonomy shape (PLAN §1: the 5-entry status set). */
export class AdapterStepError extends Error {
  constructor(
    public readonly status: "step-failed" | "selector-not-found" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "AdapterStepError";
  }
}

/** The runner-core's view of a step — adapter inputs, minus the id. */
export type AdapterStep = {
  kind: string;
  /** non-empty CSS selector (the URL for `goto`). */
  selector: string;
  /** per-step cap in ms, after the runner core applied its default. */
  timeoutMs: number;
  value?: string;
  /** same-origin iframe name to resolve first (PRD edge case 3). */
  intoFrame?: string;
};

/** Screenshot artifact, content-addressed by the caller (store.ts). */
export type ScreenshotResult = {
  bytes: Uint8Array;
  /** stable metadata for the log line (the fake reports dimensions). */
  width?: number;
  height?: number;
};

export type PageAdapter = {
  goto(url: string, capMs: number): Promise<void>;
  click(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /**
   * fill + POST-FILL VERIFICATION (PRD #43 class, edge case 3): the
   * adapter reads the value back and throws `step-failed` on mismatch —
   * a silently-failed fill must never surface as ok.
   */
  fill(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void>;
  select(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void>;
  /** presence of selector within capMs (selector-not-found on miss). */
  wait(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /**
   * assert-text VALUE CHECK (C-5): `expected` may be written as
   * `=~<text>` for a CONTAINS match; anything else is an EXACT match
   * (the real adapter trims before comparing; both adapters share the
   * form). A mismatch is ALWAYS a `step-failed` AdapterStepError whose
   * message carries expected-vs-actual — a silent pass is impossible.
   */
  assertText(selector: string, expected: string, capMs: number, intoFrame?: string): Promise<void>;
  /** selector resolves to an element within capMs. */
  assertElement(selector: string, capMs: number, intoFrame?: string): Promise<void>;
  /**
   * textContent (or attribute when `attr` is set) of the element.
   * C-5 extraction report: `expected` (when the runner names an
   * expectation) is compared against the read value and the pair is
   * recorded via `recordExtract(selector, attr, expected, actual)` —
   * the actual value is returned either way; a mismatch is NOT a step
   * failure (extraction observes, it does not gate).
   */
  extract(selector: string, capMs: number, intoFrame?: string, attr?: string, expected?: string): Promise<string>;
  /** C-5: record one extraction's expected-vs-actual into the report. */
  recordExtract?(selector: string, attr: string | undefined, expected: string | undefined, actual: string): void;
  /** fullPage capture (edge case 4). */
  screenshot(capMs: number): Promise<ScreenshotResult>;
  /** runner-core extension point — no-op on the fake. */
  close?(): Promise<void>;
};

/* ------------------------------------------------------------------ */
/* FakePageAdapter — the deterministic unit lane (DOM table)          */
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
  /** if set, fill() lands NOTHING (the #43 iframe-race simulation). */
  fillNoop?: boolean;
  present: boolean;
  clickable: boolean;
  /**
   * Real-clock wall timestamp (ms epoch); the element is ABSENT until
   * `Date.now()` passes it (timed DOM — the slow.html/dynamic.html
   * kin). Tests set it to `Date.now() + N` for a ~Nms-later element.
   */
  appearsAt?: number;
};

/**
 * `buildDom` is a fixture factory: the unit lane builds one element
 * table per URL with no browser in the loop (the §3 fake-table shape —
 * URL → element table + value map).
 */
export type FakeDomBuilder = (url: string) => { elements: Record<string, FakeElement> };

export type FakePageAdapterOptions = {
  dom: FakeDomBuilder;
  /** screenshot bytes; defaults to a deterministic byte stream per URL. */
  screenshotBytes?: (url: string) => Uint8Array;
};

/**
 * The deterministic fake. Frame elements live in the SAME table under
 * the key `${frame}::${selector}` when `intoFrame` is set (mirroring
 * the real adapter's frame resolution, without a browser).
 */
export class FakePageAdapter implements PageAdapter {
  private currentUrl = "";
  private extractLog: string[] = [];
  private fillLog: string[] = [];
  private extractReport: { selector: string; attr: string; expected?: string; actual: string }[] = [];
  private urlTables: Map<string, Record<string, FakeElement>> = new Map();

  constructor(private readonly opts: FakePageAdapterOptions) {}

  /** Test hooks: the observed extract/fill sequence (log-honesty pins). */
  get lastExtract(): string | undefined {
    return this.extractLog[this.extractLog.length - 1];
  }
  get lastFill(): string | undefined {
    return this.fillLog[this.fillLog.length - 1];
  }
  get url(): string {
    return this.currentUrl;
  }

  private elementsFor(url: string): Record<string, FakeElement> {
    // STABLE table per URL: the fake's mutations (click sets
    // clickable:false, fill sets value) persist for the lifetime of
    // this adapter — the DOM is a per-page object, not a per-call one.
    let t = this.urlTables.get(url);
    if (t === undefined) {
      // An unknown URL (or about:blank) gets an empty table, so a
      // typo'd fixture URL surfaces as selector-not-found, not a crash.
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
    if (!el && intoFrame) el = els[selector]; // a frame selector that also exists top-level
    if (el && el.appearsAt !== undefined && Date.now() < el.appearsAt) return undefined;
    if (el && !el.present) return undefined;
    return el;
  }

  private findOrThrow(selector: string, capMs: number, intoFrame?: string): FakeElement {
    const el = this.resolve(selector, intoFrame);
    if (el) return el;
    throw new AdapterStepError(
      "selector-not-found",
      `selector not found within ${capMs}ms: ${intoFrame ? `frame "${intoFrame}" > ` : ""}${selector}`,
    );
  }

  /**
   * Bounded capped poll (the operator ruling): a SINGLE real-clock
   * setTimeout chain, one probe every `max(25, capMs/20)` ms, hard-stopped
   * at `capMs` (at most ~20 iterations, never a tight loop, never an
   * unbounded re-arm). Resolves when fn() is true; rejects with a
   * `timeout` taxonomy error when the budget is spent or the selector
   * can never appear on this URL.
   */
  private async cappedWait(fn: () => boolean, capMs: number, canChange: () => boolean): Promise<void> {
    if (fn()) return;
    if (!canChange()) {
      // Absent AND no time-gated twin: a capped wait surfaces
      // selector-not-found, never hangs (the PRD edge case 2 law).
      throw new AdapterStepError(
        "selector-not-found",
        `wait: selector not found within ${capMs}ms`,
      );
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
    void capMs; // the fake resolves instantly; the cap is honored by the runner core
    if (url === "") throw new AdapterStepError("step-failed", "goto: empty URL");
    this.currentUrl = url;
    this.rebuild(url);
  }

  /** Rebuild the URL's element table (the goto boundary — a fresh page). */
  private rebuild(url: string): void {
    this.urlTables.delete(url);
    this.elementsFor(url); // build it eagerly
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
    this.fillLog.push(value);
    // Land the value — or don't (the #43-class simulation flags).
    const landValue = el.fillNoop ? undefined : el.fillCorrupt !== undefined ? el.fillCorrupt : value;
    el.fillCorrupt = undefined; // cleared after read — stable-table law
    el.fillNoop = undefined;
    el.value = landValue;
    // POST-FILL VERIFICATION (PRD #43, edge case 3): read the value
    // back; a silent mismatch is a step failure, never a false ok.
    if (el.value !== value) {
      throw new AdapterStepError(
        "step-failed",
        `fill verification failed on ${selector}: expected ${JSON.stringify(value)}, read back ${JSON.stringify(el.value)}`,
      );
    }
  }

  async select(selector: string, value: string, capMs: number, intoFrame?: string): Promise<void> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    this.fillLog.push(value);
    el.value = value;
    // Post-fill parity: the fake verifies a select landing the same way.
    if (el.value !== value) {
      throw new AdapterStepError("step-failed", `select verification failed on ${selector}`);
    }
  }

  async wait(selector: string, capMs: number, intoFrame?: string): Promise<void> {
    const found = () => this.resolve(selector, intoFrame) !== undefined;
    // A time-gated element can appear within the budget until the real
    // clock passes its `appearsAt` (the slow.html/dynamic.html kin).
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

  async extract(selector: string, capMs: number, intoFrame?: string, attr?: string, expected?: string): Promise<string> {
    const el = this.findOrThrow(selector, capMs, intoFrame);
    const value = attr !== undefined ? el.attrs[attr] : el.text;
    if (value === undefined) {
      throw new AdapterStepError(
        "step-failed",
        `extract ${attr !== undefined ? `${attr} of ${selector}` : selector}: no value found`,
      );
    }
    this.extractLog.push(value);
    this.recordExtract?.(selector, attr, expected, value);
    return value;
  }

  /** C-5 extraction report hook: every extract records expected-vs-actual. */
  recordExtract(selector: string, attr: string | undefined, expected: string | undefined, actual: string): void {
    this.extractReport.push({ selector, attr: attr ?? "text", expected, actual });
  }
  /** C-5: the step-by-step extraction report (the runner serializes it). */
  get extractionReport(): { selector: string; attr: string; expected?: string; actual: string }[] {
    return this.extractReport;
  }

  async screenshot(capMs: number): Promise<ScreenshotResult> {
    void capMs;
    const url = this.currentUrl || "about:blank";
    const bytes = this.opts.screenshotBytes?.(url) ?? FakePageAdapter.defaultBytes(url);
    const els = Object.values(this.elementsFor(url));
    const height = Math.max(24, els.length * 8);
    return { bytes, width: 800, height };
  }

  /** Deterministic bytes: 32 bytes, URL-dependent — stable per fixture. */
  static defaultBytes(url: string): Uint8Array {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = (h >>> ((i % 4) * 8)) & 0xff;
    return out;
  }
}
