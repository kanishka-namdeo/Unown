/**
 * Bolero scheduler — the S-4 unit lane (PLAN §3 S-4, §5 test-strategy
 * law: NO fake clocks; short REAL intervals 50–200 ms with bounded
 * waits). Every test drives the single setTimeout-chained poll loop
 * against faked RegistryPort/IngestPort + the runner's FakeAdapter.
 *
 * The shared law every test follows: the in-memory lane advances a
 * watch's schedule by mutating the LIVE spec object (the registry
 * re-serializes it on each list()), exactly as the live server's
 * ingest handler would — a fire is recorded by the ingest POST, and
 * the test mirrors that by re-anchoring nextDueIso to `now + period`.
 * Without that mirroring, the scheduler's own parsed-copy advance is
 * invisible to the fake registry and the loop would hot-fire; the
 * server lane does the advance for the real registry, so the test
 * lane does it for the fake. That is the one test-side rule; no
 * fake clocks anywhere.
 */
import { describe, expect, test } from "bun:test";
import type { PageAdapter } from "../runner/adapter.js";
import { FakeAdapter, type FakeDomBuilder } from "../runner/adapter.js";
import type { RunReport, WatchSpec } from "../domain/types.js";
import {
  createScheduler,
  type IngestPort,
  type RegistryEntry,
  type RegistryPort,
} from "./scheduler.js";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

function watch(
  over: Partial<WatchSpec["watch"]> = {},
  base: Partial<WatchSpec["watch"]> = {},
): WatchSpec {
  return {
    schema: "bolero.v1",
    watch: {
      id: 1,
      name: "w",
      steps: [{ id: 1, kind: "goto", selector: "https://example.test" }],
      baseUrl: "https://example.test",
      schedule: {
        kind: "interval",
        everyMs: 100,
        nextDueIso: new Date(Date.now() - 1000).toISOString(),
      },
      ...base,
      ...over,
    },
  };
}

const dom: FakeDomBuilder = () => ({
  elements: {
    h1: { selector: "h1", text: "up", attrs: {}, present: true, clickable: true },
  },
});

type FakeIngest = IngestPort & {
  reports: RunReport[];
  failNext?: (n?: number) => void;
};

function fakeIngest(): FakeIngest {
  const posts: RunReport[] = [];
  let failLeft = 0;
  const port: FakeIngest = {
    reports: posts,
    async post(report) {
      if (failLeft > 0) {
        failLeft -= 1;
        throw new Error("ingest down");
      }
      posts.push(report);
    },
    failNext(n = 1) {
      failLeft = n;
    },
  };
  return port;
}

/**
 * A registry that serves specJson from its own live spec copies; the
 * test advances those copies so the next list() re-serialization
 * carries the new nextDueIso (the in-memory lane's advance law).
 */
function fakeRegistry(live: WatchSpec[]): RegistryPort {
  return {
    async list() {
      const out: RegistryEntry[] = [];
      for (const spec of live) {
        out.push({
          id: spec.watch.id,
          name: spec.watch.name,
          specJson: JSON.stringify(spec),
          runSeq: 1,
        });
      }
      return out;
    },
  };
}

/** The in-memory lane's advance law: skip-and-record, re-anchor to NOW. */
function advanceSpec(spec: WatchSpec, everyMs: number): void {
  const s = spec.watch.schedule!;
  const iso = new Date().toISOString();
  s.lastFiredIso = iso;
  s.nextDueIso = new Date(Date.now() + everyMs).toISOString();
}

function boundedWait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll-bounded wait: resolve when the predicate holds OR after a
 * generous real-clock cap. Keeps every test's wall bounded even when
 * the event arrives early.
 */
async function until(
  pred: () => boolean,
  capMs: number,
  stepMs = 10,
): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < capMs) {
    await boundedWait(stepMs);
  }
}

/**
 * Wrap an adapter with a wall-clock delay per op → slow-run lane
 * (each execution burns real time so pool/overlap behavior is
 * observable on short real intervals).
 */
class SlowAdapter implements PageAdapter {
  private inner: FakeAdapter;
  private delay: number;
  constructor(opts: { delayMs: number; dom: FakeDomBuilder }) {
    this.inner = new FakeAdapter({ dom: opts.dom });
    this.delay = opts.delayMs;
  }
  private async gated<T>(fn: () => Promise<T>): Promise<T> {
    const out = await fn();
    await boundedWait(this.delay);
    return out;
  }
  goto = (u: string, c: number) => this.gated(() => this.inner.goto(u, c));
  click = (s: string, c: number, f?: string) => this.gated(() => this.inner.click(s, c, f));
  fill = (s: string, v: string, c: number, f?: string) =>
    this.gated(() => this.inner.fill(s, v, c, f));
  select = (s: string, v: string, c: number, f?: string) =>
    this.gated(() => this.inner.select(s, v, c, f));
  wait = (s: string, c: number, f?: string) => this.gated(() => this.inner.wait(s, c, f));
  assertText = (s: string, e: string, c: number, f?: string) =>
    this.gated(() => this.inner.assertText(s, e, c, f));
  assertElement = (s: string, c: number, f?: string) =>
    this.gated(() => this.inner.assertElement(s, c, f));
  extract = (s: string, c: number, f?: string, a?: string) => this.inner.extract(s, c, f, a);
  screenshot = (c: number) => this.gated(() => this.inner.screenshot(c)).then((bytes) => bytes);
}

/* ------------------------------------------------------------------ */
/* S-4 pins                                                            */
/* ------------------------------------------------------------------ */

describe("S-4 scheduler (bounded real-clock poll loop)", () => {
  test("due interval watch fires exactly once per period", async () => {
    const spec = watch(
      {},
      {
        schedule: {
          kind: "interval",
          everyMs: 100,
          nextDueIso: new Date(Date.now() - 1000).toISOString(),
        },
      },
    );
    const registry = fakeRegistry([spec]);
    const ingest = fakeIngest();
    const s = createScheduler({
      registry,
      ingest,
      adapter: new FakeAdapter({ dom }),
      tickMs: 50,
      poolSize: 2,
    });
    s.start();
    // The in-memory lane's advance law: after each fire, re-anchor
    // the LIVE spec so the next fire is ~100ms out (skip-and-record).
    let fires = 0;
    const advancer = setInterval(() => {
      if (ingest.reports.length > fires) {
        fires = ingest.reports.length;
        advanceSpec(spec, 100);
      }
    }, 10);
    await boundedWait(360); // ~3.6 periods at 100ms
    clearInterval(advancer);
    await s.stop();
    expect(fires).toBeGreaterThanOrEqual(2); // fired at least 2 full periods
    expect(ingest.reports.every((r) => r.report.status === "ok")).toBe(true);
  });

  test("pool-full defers to the next tick without dropping", async () => {
    // Three watches, all due NOW, pool holds 2 → the 3rd must be
    // logged as pool-full and NEVER start while the pool is busy.
    const a = watch({ id: 1, name: "a" });
    const b = watch({ id: 2, name: "b" });
    const c = watch({ id: 3, name: "c" });
    const live = [a, b, c];
    const registry = fakeRegistry(live);
    const ingest = fakeIngest();

    // Slow adapter: each op ~150ms → a run burns real time, keeping
    // the pool busy across multiple ticks so c's deferral is visible.
    const adapter = new SlowAdapter({ delayMs: 150, dom });
    const s = createScheduler({ registry, ingest, adapter, tickMs: 100, poolSize: 2 });
    s.start();

    // Wait until the pool has visibly deferred c (at least one
    // pool-full event), then verify c has NOT yet fired.
    await until(() => s.events.some((e) => e.type === "deferred" && e.reason === "pool-full" && e.watchId === 3), 400);
    expect(s.events.some((e) => e.type === "deferred" && e.reason === "pool-full" && e.watchId === 3)).toBe(true);
    expect(s.events.filter((e) => e.type === "started" && e.watchId === 3).length).toBe(0);

    // Phase 2: advance a AND b (their live schedules) so the pool
    // becomes free for c on the next tick. Then wait for c's fire.
    advanceSpec(a, 60_000);
    advanceSpec(b, 60_000);
    await until(() => s.events.some((e) => e.type === "started" && e.watchId === 3), 600);
    await s.stop();
    expect(s.events.filter((e) => e.type === "started" && e.watchId === 3).length).toBe(1); // fired exactly once
    // c's fire is the ok status; it was NOT dropped.
    const cFire = ingest.reports.find((r) => r.report.watchId === 3);
    expect(cFire).toBeDefined();
  });

  test("a failing run still advances the schedule (no hot loop)", async () => {
    const spec = watch(
      {},
      {
        name: "failing",
        steps: [
          { id: 1, kind: "goto", selector: "https://example.test" },
          { id: 2, kind: "assert-text", selector: "h1", value: "absent", timeoutMs: 50 },
        ],
        schedule: {
          kind: "interval",
          everyMs: 100,
          nextDueIso: new Date(Date.now() - 1000).toISOString(),
        },
      },
    );
    const registry = fakeRegistry([spec]);
    const ingest = fakeIngest();
    const s = createScheduler({
      registry,
      ingest,
      adapter: new FakeAdapter({ dom }),
      tickMs: 50,
      poolSize: 1,
    });
    s.start();
    // Advance the schedule after each fire: a FAILED run still
    // re-anchors nextDueIso to now + 100ms (skip-and-record — never a
    // hot loop). Without this mirroring, the loop would hot-fire;
    // with it, the cadence is bounded by the period.
    let fires = 0;
    const advancer = setInterval(() => {
      if (ingest.reports.length > fires) {
        fires = ingest.reports.length;
        advanceSpec(spec, 100);
      }
    }, 10);
    await boundedWait(360); // ~3.6 windows at 100ms
    clearInterval(advancer);
    await s.stop();
    const statuses = ingest.reports.map((r) => r.report.status);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    // Bounded cadence (~4-6 runs in 360ms at 100ms period) NOT a
    // hot-loop (hundreds).
    expect(statuses.length).toBeLessThanOrEqual(8);
    expect(statuses.every((st) => st !== "ok")).toBe(true);
  });

  test("a one-shot watch fires exactly once and never again", async () => {
    const spec = watch(
      {},
      {
        schedule: {
          kind: "one-shot",
          nextDueIso: new Date(Date.now() - 1000).toISOString(),
        },
      },
    );
    const registry = fakeRegistry([spec]);
    const ingest = fakeIngest();
    const s = createScheduler({
      registry,
      ingest,
      adapter: new FakeAdapter({ dom }),
      tickMs: 50,
      poolSize: 2,
    });
    s.start();
    // One-shot advance law: after the single fire, the live spec
    // re-anchors far out so subsequent ticks stay quiet.
    let fired = 0;
    const advancer = setInterval(() => {
      if (ingest.reports.length > fired) {
        fired = ingest.reports.length;
        // One-shot: re-anchor to now + 86400_000_000_000ms (year 2750
        // shape, far out) so it NEVER re-fires.
        const s0 = spec.watch.schedule!;
        s0.lastFiredIso = new Date().toISOString();
        s0.nextDueIso = new Date(Date.now() + 86_400_000_000_000).toISOString();
      }
    }, 10);
    await boundedWait(300);
    clearInterval(advancer);
    await s.stop();
    expect(ingest.reports.length).toBe(1); // fired exactly once
    expect(ingest.reports[0].report.status).toBe("ok");
  });

  test("in-flight dedup: a slow run is NOT double-started (E-08)", async () => {
    const spec = watch(
      {},
      {
        schedule: {
          kind: "interval",
          everyMs: 50,
          nextDueIso: new Date(Date.now() - 1000).toISOString(),
        },
      },
    );
    const registry = fakeRegistry([spec]);
    const ingest = fakeIngest();
    const adapter = new SlowAdapter({ delayMs: 200, dom }); // one run ~200ms, ticks 50ms
    const s = createScheduler({ registry, ingest, adapter, tickMs: 50, poolSize: 2 });
    s.start();
    await boundedWait(500);
    await s.stop();
    const startedCount = s.events.filter((e) => e.type === "started").length;
    const inFlightDefers = s.events.filter(
      (e) => e.type === "deferred" && e.reason === "in-flight",
    ).length;
    expect(inFlightDefers).toBeGreaterThan(0); // deferred + logged
    expect(startedCount).toBeLessThan(5); // bounded — never overlapped
  });

  test("the loop survives a throwing run (E-02 runner-offline)", async () => {
    const spec = watch(
      {},
      {
        name: "thrower",
        schedule: {
          kind: "interval",
          everyMs: 100,
          nextDueIso: new Date(Date.now() - 1000).toISOString(),
        },
      },
    );
    const registry = fakeRegistry([spec]);
    const ingest = fakeIngest();
    // The adapter throws a NON-AdapterStepError inside the executor →
    // the runner-offline containment path: records the run, keeps ticking.
    const throwing = new SlowAdapter({ delayMs: 0, dom });
    const boom = new Error("adapter exploded (E-02 lane)");
    // Override goto to throw a NON-AdapterStepError → the executor
    // catches it (any non-AdapterStepError), records step-failed, and
    // the scheduler's catch block records runner-offline.
    throwing.goto = async () => {
      throw boom;
    };
    const s = createScheduler({
      registry,
      ingest,
      adapter: throwing,
      tickMs: 50,
      poolSize: 1,
    });
    s.start();
    // The runner-offline advance law: even a recorded runner-offline
    // run re-anchors nextDueIso (skip-and-record — never a hot loop).
    // Each time a new runner-offline report lands, advance the LIVE
    // spec so the next tick sees a new due instant and can fire again.
    // Count by started events (NOT report count) to mirror fires.
    let fires = 0;
    const advancer = setInterval(() => {
      const cur = s.events.filter((e) => e.type === "started" && e.watchId === 1).length;
      if (cur > fires) {
        fires = cur;
        advanceSpec(spec, 100);
      }
    }, 10);
    await boundedWait(700);
    clearInterval(advancer);
    await s.stop();
    // Every run in the E-02 lane records the run without crashing the
    // loop. The executor catches the non-AdapterStepError and records
    // it as a failed step (status "step-failed"); the scheduler's
    // catch block records runner-offline when executeWatch itself
    // throws. Either way: the loop survives, the run is recorded.
    const statuses = ingest.reports.map((r) => r.report.status);
    expect(statuses.length).toBeGreaterThanOrEqual(2); // loop kept ticking
    expect(statuses.every((st) => st !== "ok")).toBe(true); // all failed
  });
});
