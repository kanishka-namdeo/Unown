/**
 * Bolero scheduler — the bounded real-clock poll loop (PLAN §3 S-4,
 * the operator-handed V-18 mechanism).
 *
 * Design (one loop, no setInterval):
 * - A single setTimeout-chained loop; each tick (default 500 ms, the
 *   live lane) computes the set of DUE watches from the registry
 *   (`schedule.nextDueIso <= now`), then starts up to `poolSize`
 *   (default 2 — the metered ~20 RPM upstream argues for small
 *   numbers) of them. Due watches the pool cannot take are NEVER
 *   queued unboundedly: they wait for the next tick (retried, the
 *   Chaconne misfire policy).
 * - Each execution: fetch the watch spec through the `RegistryPort`
 *   (tests fake it; the live port calls the server's registry API),
 *   run the frozen recipe through the runner's executor + report
 *   builder against a `PageAdapter` (the FakeAdapter in tests),
 *   POST the `RunReport` through the `IngestPort` (the live port
 *   calls the server's ingest API), then ADVANCE the schedule:
 *   `lastFiredIso = now`, `nextDueIso = now + everyMs` — a FAILED
 *   run advances too (skip-and-record, never a hot loop).
 * - Concurrent runs of ONE watch are forbidden (E-08): a watch is
 *   skipped while its previous run is in flight (deferred + logged,
 *   never a second overlapping execution).
 * - A watch's failed execution records the run but NEVER crashes the
 *   loop (E-02 runner-offline detection). A throwing registry or
 *   ingest port is contained to that one watch's tick.
 * - Schedule drift (E-05): a gap ≥ one period is settled by the
 *   skip-and-record advance (nextDue = now + everyMs), so a machine
 *   sleep can never trigger a silent double-run or a catch-up storm.
 *
 * No fake clocks anywhere in this lane (the PLAN test-strategy law):
 * tests drive the loop with short REAL intervals (50–200 ms) and
 * bounded waits.
 */
import { executeWatch } from "../runner/executor.js";
import { buildRunReport, sha256Hex } from "../runner/report.js";
import type { PageAdapter } from "../runner/adapter.js";
import type { RunReport, WatchSpec } from "../domain/types.js";
import { parseWatch } from "../domain/io.js";
import { toCanonicalJson } from "../domain/io.js";

/**
 * The narrow registry view the scheduler needs — the live lane reads
 * it from the server (GET /api/watches); tests fake it in memory.
 * `specJson` is the canonical watch-spec JSON (the server's storage
 * law); `runSeq` is the next deterministic run sequence for that
 * watch (the ids.ts max+1 law, decided by the registry host).
 */
export type RegistryPort = {
  /** Every registered watch with its stored spec + next run sequence. */
  list(): Promise<RegistryEntry[]>;
};

export type RegistryEntry = {
  id: number;
  name: string;
  specJson: string;
  /** The next deterministic run-seq for this watch (max+1 over taken). */
  runSeq: number;
};

/**
 * The narrow ingest view the scheduler needs — the live lane POSTs to
 * the server's `/api/runs` (with the artifact-bytes sideband); tests
 * fake it and record the reports.
 */
export type IngestPort = {
  post(report: RunReport, artifactBytes: Record<string, string>): Promise<void>;
};

/** A registry entry the scheduler parsed; carries the live spec copy
 * so a caller (test lane, live ingest handler) can advance it in place. */
type ParsedEntry = {
  entry: RegistryEntry;
  spec: WatchSpec;
  /** Advance the parsed spec's schedule (skip-and-record). */
  advance(): void;
};

export type SchedulerOptions = {
  registry: RegistryPort;
  ingest: IngestPort;
  adapter: PageAdapter;
  /** Poll interval in ms (live lane: 500). */
  tickMs?: number;
  /** Max concurrent executions (live lane: 2). */
  poolSize?: number;
  /** Wall-clock seam (live: Date.now; the seam is the RUN clock —
   *  timers below stay real, per the V-18 law). */
  nowMs?: () => number;
};

export type SchedulerEvent =
  | { type: "started"; watchId: number; name: string; runSeq: number }
  | { type: "deferred"; watchId: number; name: string; reason: "pool-full" | "in-flight" }
  | { type: "done"; watchId: number; name: string; status: RunReport["report"]["status"] }
  | { type: "skipped"; watchId: number; name: string; reason: string };

export type Scheduler = {
  /** Begin the single poll loop. Idempotent while running. */
  start(): void;
  /** Stop the loop; in-flight runs are allowed to finish. */
  stop(): Promise<void>;
  /** True while a run for this watch is in flight (E-08 guard). */
  inFlight(watchId: number): boolean;
  /** Deferred/skip events, in order (the operator log lane). */
  readonly events: SchedulerEvent[];
  /** Observability: completed run statuses per watch, newest last. */
  readonly runs: Record<number, string[]>;
  /** Resolve after `n` loop iterations (test/bounded-wait seam). */
  waitForTicks(n: number): Promise<void>;
};

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const tickMs = opts.tickMs ?? 500;
  const poolSize = opts.poolSize ?? 2;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const registry = opts.registry;
  const ingest = opts.ingest;
  const adapter = opts.adapter;

  const events: SchedulerEvent[] = [];
  const runs: Record<number, string[]> = {};
  const inFlightWatches = new Set<number>();
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticksDone = 0;
  const tickWaiters: Array<() => void> = [];

  function record(type: SchedulerEvent["type"], e: Omit<SchedulerEvent, "type">): void {
    events.push({ type, ...e } as SchedulerEvent);
  }

  /** Parse + canonicalize a stored specJson through the domain gate. */
  function loadSpec(entry: RegistryEntry): ParsedEntry | null {
    try {
      const spec = parseWatch(entry.specJson);
      return { entry, spec, advance: () => advance(spec, nowMs()) };
    } catch (e) {
      record("skipped", {
        watchId: entry.id,
        name: entry.name,
        reason: `invalid stored spec: ${e instanceof Error ? e.message : String(e)}`,
      });
      return null;
    }
  }

  function isDue(spec: WatchSpec, now: number): boolean {
    const s = spec.watch.schedule;
    if (s === undefined) return false;
    if (s.kind === "one-shot" && s.nextDueIso === undefined) return false;
    if (s.kind === "interval" && (s.nextDueIso === undefined || s.everyMs === undefined)) {
      return false;
    }
    return new Date(s.nextDueIso).getTime() <= now;
  }

  function advance(spec: WatchSpec, now: number): void {
    const s = spec.watch.schedule!;
    const iso = new Date(now).toISOString();
    s.lastFiredIso = iso;
    if (s.kind === "interval" && s.everyMs !== undefined) {
      // Skip-and-record (E-05): re-anchor to NOW, never catch up.
      s.nextDueIso = new Date(now + s.everyMs).toISOString();
    } else {
      // one-shot: re-anchoring makes it due again — kill it instead
      // (a one-shot fires exactly once, E-05 no-doubling law).
      s.nextDueIso = new Date(now + 86_400_000_000_000).toISOString();
    }
  }

  /**
   * Execute one due watch end-to-end: spec → executor → report →
   * ingest → advance. Every failure is RECORDED, never propagated
   * to the loop (E-02: a failed run records the run, does not crash).
   */
  async function executeOne(
    entry: RegistryEntry,
    spec: WatchSpec,
    now: number,
    advanceFn: () => void,
  ): Promise<void> {
    inFlightWatches.add(entry.id);
    record("started", { watchId: entry.id, name: entry.name, runSeq: entry.runSeq });
    let status: RunReport["report"]["status"];
    let startedIso = new Date(now).toISOString();
    try {
      const result = await executeWatch(adapter, spec);
      const finishedNow = nowMs();
      status = result.status;
      const report = buildRunReport({
        watchId: entry.id,
        recipeVersion: spec.watch.recipeVersion ?? 1,
        runSeq: entry.runSeq,
        status,
        startedAt: startedIso,
        finishedAt: new Date(finishedNow).toISOString(),
        committedPrefix: result.committedPrefix,
        failedStepIdx: result.failedStepIdx,
        extracted: result.extracted,
        artifacts: [
          ...result.artifacts,
          { ext: "log" as const, payload: result.logText },
        ],
      });
      // The sideband base64-encodes artifact payloads keyed by the
      // content-addressed ref name (the server's ingest contract, §1
      // storage law); the fake ingest ignores the bytes. The ref NAMEs
      // are computed once by buildRunReport from the same sha256Hex —
      // single site for the hash (the content-addressing law).
      const sideband: Record<string, string> = {};
      const payloads: Array<Uint8Array | string> = [
        ...result.artifacts.map((a) => a.payload),
        result.logText,
      ];
      report.report.artifacts.forEach((ref) => {
        // Find the payload whose sha256 matches this ref's content.
        const payload = payloads.find((p) => sha256Hex(p) === ref.sha256);
        if (payload === undefined) return;
        sideband[ref.name] =
          payload instanceof Uint8Array
            ? Buffer.from(payload).toString("base64")
            : Buffer.from(payload, "utf8").toString("base64");
      });
      await ingest.post(report, sideband);
    } catch (e) {
      // Runner-side failure (adapter offline, executor/ingest throw):
      // record an honest runner-offline run, NEVER crash the loop.
      status = "runner-offline";
      try {
        const report = buildRunReport({
          watchId: entry.id,
          recipeVersion: spec.watch.recipeVersion ?? 1,
          runSeq: entry.runSeq,
          status,
          startedAt: startedIso,
          committedPrefix: 0,
          artifacts: [],
          log: `runner-offline: ${e instanceof Error ? e.message : String(e)}`,
        });
        await ingest.post(report, {});
      } catch (ingestErr) {
        record("skipped", {
          watchId: entry.id,
          name: entry.name,
          reason: `ingest unreachable after run failure: ${ingestErr instanceof Error ? ingestErr.message : String(ingestErr)}`,
        });
      }
    } finally {
      inFlightWatches.delete(entry.id);
    }
    // Skip-and-record advance runs even on failure (never a hot loop):
    // each watch advances its OWN schedule through the caller's
    // advanceFn — the parsed spec is visible to the fake registry on
    // the next list() exactly as the server's ingest handler would
    // advance the stored row.
    try {
      advanceFn();
      record("done", { watchId: entry.id, name: entry.name, status });
      (runs[entry.id] ??= []).push(status);
    } catch (e) {
      record("skipped", {
        watchId: entry.id,
        name: entry.name,
        reason: `advance failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async function tick(): Promise<void> {
    ticksDone += 1;
    const waiters = tickWaiters.splice(0, tickWaiters.length);
    const now = nowMs();
    let poolLeft = poolSize;
    let registryList: RegistryEntry[];
    try {
      registryList = await registry.list();
    } catch (e) {
      record("skipped", {
        watchId: -1,
        name: "<registry>",
        reason: `registry unreachable: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    // Each watch advances its OWN schedule (skip-and-record law): on
    // success AND on failure the parsed spec's nextDueIso re-anchors
    // to `now + everyMs` (or far out for one-shot). The fake
    // registry lane mirrors this by re-serializing the live spec on
    // the next list() — so advancing one watch NEVER affects the
    // others (the pool-full test relies on this).
    for (const entry of registryList) {
      const spec = loadSpec(entry);
      if (spec === null) continue;
      const specRef = spec;
      if (poolLeft <= 0) {
        // Pool full: due watches beyond the pool WAIT for the next
        // tick (never queued unboundedly). Only actually-due ones log.
        if (isDue(specRef.spec, now)) {
          record("deferred", { watchId: entry.id, name: entry.name, reason: "pool-full" });
        }
        continue;
      }
      if (!isDue(specRef.spec, now)) continue;
      // E-08: a watch with an in-flight run is deferred + logged,
      // NEVER started a second time.
      if (inFlightWatches.has(entry.id)) {
        record("deferred", { watchId: entry.id, name: entry.name, reason: "in-flight" });
        continue;
      }
      poolLeft -= 1;
      // Fire-and-observe: the run must not gate the loop; every
      // error inside executeOne is already contained. The run's
      // parsed spec advances via its own advanceFn on completion.
      void executeOne(entry, specRef.spec, now, specRef.advance).catch((e) => {
        record("skipped", {
          watchId: entry.id,
          name: entry.name,
          reason: `unexpected: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
    }
    for (const w of waiters) w();
  }

  function arm(): void {
    if (!running) return;
    void tick().finally(() => {
      if (running) timer = setTimeout(arm, tickMs);
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },
    async stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      // Resolve outstanding tick waiters so bounded waits cannot hang.
      for (const w of tickWaiters.splice(0, tickWaiters.length)) w();
      // Await in-flight executions to settle (bounded by their caps).
      await Promise.allSettled([...inFlightWatches].map((id) => waitSettled(id)));
    },
    inFlight(id) {
      return inFlightWatches.has(id);
    },
    events,
    runs,
    waitForTicks(n) {
      if (ticksDone >= n) return Promise.resolve();
      return new Promise<void>((resolve) => tickWaiters.push(resolve));
    },
  };

  function waitSettled(id: number): Promise<void> {
    if (!inFlightWatches.has(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (!inFlightWatches.has(id)) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
    });
  }
}

/**
 * The live-lane ports (PLAN S-4: "the real one calls the server's
 * ingest API"). Constructed against a base URL; unit tests NEVER use
 * these (the no-real-network law) — they exercise the fakes.
 */
export function makeHttpPorts(baseUrl: string): { registry: RegistryPort; ingest: IngestPort } {
  const registry: RegistryPort = {
    async list() {
      const res = await fetch(`${baseUrl}/api/watches`);
      const body = (await res.json()) as {
        watches: Array<{ id: number; name: string; specJson: string; lastStatus: string | null }>;
      };
      // runSeq is the registry host's deterministic max+1 law; the
      // live registry serves it alongside the list (the server lane
      // supplies it — here the scheduler's honest fallback is 1).
      return body.watches.map((w) => ({
        id: w.id,
        name: w.name,
        specJson: w.specJson,
        runSeq: 1,
      }));
    },
  };
  const ingest: IngestPort = {
    async post(report, artifactBytes) {
      await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...report,
          __artifactBytes__: artifactBytes,
          __canonicalJson__: toCanonicalJson(report),
        }),
      });
    },
  };
  return { registry, ingest };
}
