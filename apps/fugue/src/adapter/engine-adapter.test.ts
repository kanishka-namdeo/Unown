/**
 * engine-adapter.test.ts — interface-conformance + error-path pins
 * (PLAN §3 F-2, co-located).
 *
 * - Interface conformance: `FakeEngineAdapter` satisfies every
 *   `EngineAdapter` method (assignability + a live call of each method).
 * - Error-path pins: EngineLocked / EngineDown surface as the typed
 *   taxonomy classes with the `kind` discriminator; EngineDrift is
 *   driven through a scripted MUTATED fixture.
 */
import { test, expect } from "bun:test";
import type { EngineAdapter } from "./engine-adapter.js";
import {
  EngineLocked,
  EngineDown,
  EngineDrift,
  EngineError,
  type EngineErrorKind,
} from "./engine-adapter.js";
import {
  FakeEngineAdapter,
  makeFakeClock,
} from "./fake-engine-adapter.js";
import { CONTRACT_FIXTURES, DREAMS_LIVE_FIXTURE, MEMORY_LIVE_FIXTURE, MEMORY_HEALTH_LIVE_FIXTURE } from "./contract.js";
import { mapDreams, mapMemory } from "./rest-adapter.js";

/** A fixed injected clock — the fake must never read a real timer.
 *  (The TEST file may read a real clock for its fixture epoch; the
 *  ADAPTER takes the clock via injection and never calls it itself.) */
const EPOCH = Date.UTC(2026, 10, 7, 9, 0, 0);

function fresh(): FakeEngineAdapter {
  return new FakeEngineAdapter(makeFakeClock(EPOCH).now);
}

/* — 1. interface conformance: the fake IS an EngineAdapter (every method) — */

test("FakeEngineAdapter is assignable to EngineAdapter (type-level)", () => {
  const asIface: EngineAdapter = fresh();
  expect(typeof asIface.listAutomations).toBe("function");
  expect(typeof asIface.createAutomation).toBe("function");
  expect(typeof asIface.pauseAutomation).toBe("function");
  expect(typeof asIface.resumeAutomation).toBe("function");
  expect(typeof asIface.runNow).toBe("function");
  expect(typeof asIface.skip).toBe("function");
  expect(typeof asIface.snooze).toBe("function");
  expect(typeof asIface.history).toBe("function");
  expect(typeof asIface.overview).toBe("function");
  expect(typeof asIface.runs).toBe("function");
  expect(typeof asIface.dreams).toBe("function");
  expect(typeof asIface.notes).toBe("function");
  expect(typeof asIface.memories).toBe("function");
  expect(typeof asIface.spend).toBe("function");
});

test("every method resolves with the canned fixture shape", async () => {
  const a = fresh();
  const automations = await a.listAutomations();
  expect(automations).toEqual(CONTRACT_FIXTURES.automations);

  const created = await a.createAutomation({
    title: "t",
    prompt: "p",
    schedule: { kind: "once", delayMinutes: 1 },
    mode: "read-only",
  });
  expect(created.id).toBeGreaterThan(2);
  expect(created.state).toBe("active");

  // runNow prepends one synthetic run to the history (the fake's own
  // accounting, E-12) — account for it instead of expecting the
  // un-mutated fixture.
  const preRuns = CONTRACT_FIXTURES.runs;
  await a.runNow(2);
  const afterRuns = await a.runs();
  expect(afterRuns.length).toBe(preRuns.length + 1);
  expect(afterRuns.slice(1)).toEqual(preRuns); // the canned tail is intact

  await a.skip(1);
  await a.snooze(1, 30);
  expect((await a.history(2)).length).toBeGreaterThanOrEqual(1);

  expect(await a.overview()).toEqual(CONTRACT_FIXTURES.overview);
  // The canned dreams lane serves BOTH wire forms (the V-24 law):
  // the live rows (done + gated + running) through the dual-form
  // mapper, then the F-2 fixture's camelCase rows — five total.
  const cannedDreams = [
    ...mapDreams((DREAMS_LIVE_FIXTURE as unknown as { dreams: Record<string, unknown>[] }).dreams),
    ...mapDreams(CONTRACT_FIXTURES.dreams as unknown as Record<string, unknown>[]),
  ];
  expect(await a.dreams()).toEqual(cannedDreams);
  // The fixture's gated row rides through the mapper as the live
  // "gated" spelling (E-06: never a success badge).
  const gateds = (await a.dreams()).filter((d) => d.status === "gated");
  expect(gateds.length).toBe(2);
  expect(await a.notes()).toEqual(CONTRACT_FIXTURES.notes);
  // The canned memories lane: the live tiers + health, with the F-2
  // fixture's version stamp folded into the degraded health lane
  // (the fake's constructor merges them; the test asserts the merged
  // truth rather than one form alone).
  const memories = await a.memories();
  expect(memories.tiers.length).toBeGreaterThan(0);
  expect(memories.health.backend).toBe("lexical");
  expect(memories.health.maxRendered).toBe(110);
  expect(await a.spend()).toEqual(CONTRACT_FIXTURES.spend);
});

/* — 2. error-path pins (E-01 / E-02 / drift) — */

test("EngineLocked surfaces as the typed class with the kind discriminator", async () => {
  const a = fresh();
  a.failWith("engine-locked");
  let caught: unknown;
  try {
    await a.overview();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EngineLocked);
  expect((caught as EngineLocked).kind).toBe("engine-locked");
});

test("EngineDown surfaces as the typed class with the kind discriminator", async () => {
  const a = fresh();
  a.failWith("engine-down");
  let caught: unknown;
  try {
    await a.spend();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EngineDown);
  expect((caught as EngineDown).kind).toBe("engine-down");
});

test("all taxonomy classes are EngineError subclasses (base contract)", () => {
  for (const e of [
    new EngineLocked("x"),
    new EngineDown("x"),
    new EngineDrift("x"),
  ]) {
    expect(e).toBeInstanceOf(EngineError);
    expect(e).toBeInstanceOf(Error);
    expect(typeof e.kind).toBe("string");
  }
});

test("a forced error clears after one call (subsequent calls are canned)", async () => {
  const a = fresh();
  a.failWith("engine-locked");
  await expect(a.overview()).rejects.toBeInstanceOf(EngineLocked);
  // The next call returns to the canned state — no sticky failure.
  expect(await a.overview()).toEqual(CONTRACT_FIXTURES.overview);
});

test("EngineDrift is driven through a MUTATED scripted fixture", async () => {
  const a = fresh();
  // A well-formed mutated fixture: still shape-valid, different data.
  const goodMutated = {
    runs: [
      {
        id: 99,
        taskId: 1,
        kind: "cron",
        status: "capped" as const,
        startedAt: "2026-11-09T00:00:00Z",
        endedAt: null,
        tokensIn: 5,
        tokensOut: 0,
        toolCalls: 0,
        turns: 1,
        error: "cap hit",
      },
    ],
  };
  a.setNextResponse("runs", goodMutated);
  const rows = await a.runs();
  expect(rows[0].id).toBe(99);
  expect(rows[0].status).toBe("capped");

  // A shape-INVALID script is rejected when scripted (the fake never
  // serves its own drift) — this is the EngineDrift path surfaced
  // deterministically in the unit lane.
  const a2 = fresh();
  const badScript = {
    runs: [{ id: 1, taskId: 1, kind: "cron", status: "ok" as const }],
  };
  expect(() => a2.setNextResponse("runs", badScript)).toThrow(EngineDrift);
});

test("setNextResponse(null) clears a script and falls back to canned", async () => {
  const a = fresh();
  a.setNextResponse("spend", { ...CONTRACT_FIXTURES.spend, calls: 7 });
  expect((await a.spend()).calls).toBe(7);
  a.setNextResponse("spend", null);
  // The script is consumed already; the next call is canned again.
  expect((await a.spend()).calls).toBe(CONTRACT_FIXTURES.spend.calls);
});
