/**
 * adapter-contract.test.ts — F-3's contract lane (PLAN §3 F-3;
 * deliberately OUTSIDE src/** so the root battery's src-filter does
 * not pick it up — it is Node-edge test code, like runner/).
 *
 * Spins the fixture server (runner/fixture-server.ts) on port 4130
 * and drives the REAL rest-adapter (src/adapter/rest-adapter.ts)
 * against it through the raw client (runner/engine-client.ts).
 *
 * Pins:
 *  - every endpoint's happy path (the F-2 fixtures round-trip the
 *    real adapter + assertContract)
 *  - 401 -> EngineLocked
 *  - 503 / refused connection -> EngineDown
 *  - a mutated fixture -> EngineDrift (the dotted-path message)
 *  - the five-kind schedule mapping + E-03 (re-sync by routine id
 *    after the fixture restarts, state persists in the fixture store)
 */
import { test, expect, afterAll } from "bun:test";
import {
  EngineClient,
  EngineDown,
  EngineLocked,
} from "../runner/engine-client.js";
import { startFixtureServer, type FixtureServer } from "../runner/fixture-server.js";
import { RestAdapter, type RestAdapterClient } from "../src/adapter/rest-adapter.js";
import { EngineDrift, type AutomationRecord } from "../src/adapter/engine-adapter.js";
import {
  CONTRACT_FIXTURES,
  OVERVIEW_FIXTURE,
} from "../src/adapter/contract.js";
import type { RunRecordView } from "../src/domain/types.js";

const PORT = 4132;

/** The fixture server lifecycle: track the open server so a failed
 *  test (one that skips `await fixture.close()`) never leaks the bound
 *  port to the next makeFixture (the isolation law: a test file never
 *  leaks a bound port). */
let openFixture: FixtureServer | null = null;
afterAll(async () => {
  if (openFixture) {
    await openFixture.close();
    openFixture = null;
  }
});

/** Wrap the raw client as the adapter's injected transport. */
function clientAdapter(client: EngineClient): RestAdapter {
  const rc: RestAdapterClient = {
    call: (method, path, body) => client.request(method, path, body),
    nowMs: () => 0,
  };
  return new RestAdapter(rc);
}

async function makeFixture(reseed: boolean): Promise<FixtureServer> {
  // The previous server must be stopped before rebinding the port.
  if (openFixture) {
    await openFixture.close();
    openFixture = null;
  }
  const server = await startFixtureServer({ port: PORT, reseed });
  openFixture = server;
  return server;
}

/** A direct client for a port that listens on nothing. */
function downClient(): EngineClient {
  return new EngineClient({
    baseUrl: "http://127.0.0.1:4230",
    token: "test-token",
    timeoutMs: 500,
  });
}

test("F-3: engine happy path — every endpoint round-trips the real adapter", async () => {
  const fixture = await makeFixture(true);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);

  // overview: the F-2 canned KPI object.
  const overview = await adapter.overview();
  expect(overview.phase).toBe(OVERVIEW_FIXTURE.phase);
  expect(overview.dreams).toBe(OVERVIEW_FIXTURE.dreams);

  // automations: the two seeded rows (ids 1 and 2) map to records.
  const autos = await adapter.listAutomations();
  expect(autos.length).toBe(2);
  expect(autos[0].id).toBe(1);
  expect(autos[0].title).toBe("Weekly memory consolidation");
  expect(autos[1].id).toBe(2);

  // runs / dreams / notes / memories / spend: the canned fixtures.
  const runs = await adapter.runs();
  expect(runs.length).toBe(2);
  expect(runs[0].id).toBe(11);
  expect(runs[0].status).toBe("ok");
  expect(runs[0].tokensIn).toBe(1200);

  const dreams = await adapter.dreams();
  expect(dreams.length).toBe(2);
  expect(dreams[1].status).toBe("gated");

  const notes = await adapter.notes();
  expect(notes.length).toBe(2);
  expect(notes[0].text).toBe("Pinned the no-phantom-drift invariant.");

  const memories = await adapter.memories();
  expect(memories.healthy).toBe(true);
  expect(memories.tiers).toBe(4);

  const spend = await adapter.spend();
  expect(spend.calls).toBe(41);
  expect(spend.throttled).toBe(false);

  await fixture.close();
});

test("F-3: 401 -> EngineLocked (the E-01 path)", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);

  fixture.setAuth(true); // the server now 401s every /api call
  await expect(adapter.listAutomations()).rejects.toThrow(EngineLocked);
  await expect(adapter.overview()).rejects.toThrow(EngineLocked);

  fixture.setAuth(false); // back to open — the next call succeeds.
  const autos = await adapter.listAutomations();
  expect(autos.length).toBeGreaterThanOrEqual(2);
  await fixture.close();
});

test("F-3: 503 -> EngineDown, and a refused connection -> EngineDown", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);

  fixture.setFailure(503); // one-shot 503
  await expect(adapter.overview()).rejects.toThrow(EngineDown);

  // a second call (no failure scripted) succeeds — the 503 was one-shot.
  expect((await adapter.overview()).phase).toBe("ready");

  // a refused port (nothing listening on 4230) is the pure transport path.
  const down = clientAdapter(downClient());
  await expect(down.overview()).rejects.toThrow(EngineDown);
  await fixture.close();
});

test("F-3: a mutated fixture -> EngineDrift with the dotted-path message", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);

  // The automations GET is scripted to serve a MUTATED fixture: the
  // pinned F-2 shape has `automations[].schedule` as an object with a
  // `kind` enum — drop the kind field and assertContract must throw
  // the dotted-path drift (the anti-rot law, exercised end-to-end).
  const mutated = {
    ...structuredClone(CONTRACT_FIXTURES.automations),
    ...{
      automations: [
        {
          ...CONTRACT_FIXTURES.automations[0],
          schedule: { kind: "bogus-kind", expr: "0 9 * * 1" },
        },
      ],
    },
  };
  fixture.setPayload("automations", { status: 200, body: mutated });
  try {
    await adapter.listAutomations();
    throw new Error("expected EngineDrift, got a resolved list");
  } catch (e) {
    expect(e).toBeInstanceOf(EngineDrift);
    expect((e as EngineDrift).message).toContain("automations[0].schedule.kind");
  }
  await fixture.close();
});

test("F-3: create + lifecycle + history + the five-kind schedule mapping", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);

  // create: a cron schedule round-trips to an AutomationRecord.
  const created = await adapter.createAutomation({
    title: "Hourly sweep",
    prompt: "Sweep the queue.",
    schedule: { kind: "cron", expr: "0 * * * *" },
    mode: "standard",
  });
  expect(created.id).toBe(3);
  expect(created.title).toBe("Hourly sweep");
  expect(created.schedule.kind).toBe("cron");
  expect(created.state).toBe("active");

  // pause / resume are lifecycle PATCHes (the engine has no dedicated
  // /pause route — pinned from server.ts).
  await adapter.pauseAutomation(3);
  await adapter.resumeAutomation(3);

  // run-now + skip + snooze: the POST action routes.
  await adapter.runNow(3);
  await adapter.skip(3);
  await adapter.snooze(3, 15);

  // history for the created row (the fixture's per-id runs lane).
  const history = await adapter.history(3);
  expect(Array.isArray(history)).toBe(true);

  // create through all five schedule kinds: the adapter's mapping.
  const kinds = [
    { kind: "cron", expr: "0 9 * * 1" },
    { kind: "every", spec: "1d" },
    { kind: "after", spec: "2d" },
    { kind: "once", delayMinutes: 30 },
    { kind: "event", name: "push.received", filter: "repo=unown" },
  ] as const;
  for (const s of kinds) {
    const rec = await adapter.createAutomation({
      title: `kind-${s.kind}`,
      prompt: `a ${s.kind} job`,
      schedule: s,
      mode: "read-only",
    });
    expect(rec.schedule.kind).toBe(s.kind);
  }
  await fixture.close();
});

test("F-3: E-03 — re-sync by routine id after the fixture restarts", async () => {
  // First boot: seed the store and create a routine (id 3).
  let fixture = await makeFixture(true);
  let client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  let adapter = clientAdapter(client);
  const created = await adapter.createAutomation({
    title: "Survivor",
    prompt: "Created before the restart.",
    schedule: { kind: "every", spec: "1d" },
    mode: "standard",
  });
  const survivorId = created.id; // 3
  const storeBefore = fixture.mutations().store;
  await fixture.close(); // the "restart" — the module store persists

  // Second boot: the same store is still there; re-sync by id.
  fixture = await makeFixture(false); // no reseed — inherit the store
  client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  adapter = clientAdapter(client);
  const reSynced = await adapter.listAutomations();
  const found = reSynced.find((a) => a.id === survivorId);
  expect(found).toBeDefined();
  expect(found!.title).toBe("Survivor");
  // The store carried the routine across the restart (no reseed).
  expect(storeBefore.automations[String(survivorId)]).toBeDefined();
  await fixture.close();
});

test("F-3: the raw client maps a 401 to EngineLocked at the wire", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  fixture.setAuth(true);
  await expect(client.overview()).rejects.toThrow(EngineLocked);
  fixture.setAuth(false);
  const raw = (await client.overview()) as { phase: string };
  expect(raw.phase).toBe("ready");
  await fixture.close();
  openFixture = null;
});
