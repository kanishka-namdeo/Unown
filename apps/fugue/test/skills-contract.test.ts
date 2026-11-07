/**
 * skills-contract.test.ts — the F-7 chunk 3 contract lane: the
 * /api/skills both-forms pin + the engine/skills-staged fixture
 * server endpoints, driven over the REAL adapter (the PLAN §3
 * contract-lane precedent in test/adapter-contract.test.ts).
 *
 * OUTSIDE src/** (the root battery's src-filter does not pick it
 * up — Node-edge test code, like the existing contract lane):
 *   - the LIVE wire form ({"skills":[]} — a fresh engine home; a
 *     non-empty SkillRow {id, project_slug, created_at, updated_at})
 *     passes assertContract("skills") + mapSkills with the RAW
 *     string id uncoerced.
 *   - the F-2 fixture lane's camelCase hypothesis row
 *     ({id, projectSlug, createdAt, updatedAt}) is admitted by the
 *     permissive pin (the dual-form law — neither lane deleted).
 *   - a skill row with a NON-STRING id is drift (the anti-rot law:
 *     the permissive pin is permissive over the OPTIONAL fields,
 *     never over the id).
 *   - the fixture server answers /api/skills with the honest empty
 *     state (the V-41 law: no fake data — the live truth is []).
 *   - the fake adapter's honest empty skills() lane (a fresh engine
 *     home has zero DB skills; a seeded row round-trips verbatim).
 */
import { test, expect, afterAll } from "bun:test";
import {
  startFixtureServer,
  type FixtureServer,
} from "../runner/fixture-server.js";
import { EngineClient } from "../runner/engine-client.js";
import { RestAdapter, type RestAdapterClient, mapSkills } from "../src/adapter/rest-adapter.js";
import { assertContract } from "../src/adapter/contract.js";
import { EngineDrift, type SkillRecord } from "../src/adapter/engine-adapter.js";
import { FakeEngineAdapter, makeFakeClock } from "../src/adapter/fake-engine-adapter.js";

const PORT = 4135;

let openFixture: FixtureServer | null = null;
afterAll(async () => {
  if (openFixture) {
    await openFixture.close();
    openFixture = null;
  }
});

async function makeFixture(reseed: boolean): Promise<FixtureServer> {
  if (openFixture) {
    await openFixture.close();
    openFixture = null;
  }
  const server = await startFixtureServer({ port: PORT, reseed });
  openFixture = server;
  return server;
}

function clientAdapter(client: EngineClient): RestAdapter {
  const rc: RestAdapterClient = {
    call: (method, path, body) => client.request(method, path, body),
    nowMs: () => 0,
  };
  return new RestAdapter(rc);
}

/* — the both-forms pins (assertContract("skills")) — */

test("skills contract: the LIVE wire form — an empty table passes (the live truth)", () => {
  // Operator-captured 2026-11-07: a fresh engine home answers
  // {"skills":[]} — the pin must admit the empty array.
  expect(() => assertContract("skills", { skills: [] })).not.toThrow();
  expect(mapSkills([])).toEqual([]);
});

test("skills contract: a non-empty SkillRow (snake_case, string id) passes + maps with the RAW id", () => {
  const row = {
    skills: [
      {
        id: "skl-7f3a91",
        project_slug: "agent-service-c5ccfe",
        created_at: 1794000000000,
        updated_at: 1794063969594,
      },
    ],
  };
  expect(() => assertContract("skills", row)).not.toThrow();
  const mapped = mapSkills(row.skills) as SkillRecord[];
  expect(mapped.length).toBe(1);
  expect(mapped[0].id).toBe("skl-7f3a91"); // raw string id, uncoerced
  expect(mapped[0].projectSlug).toBe("agent-service-c5ccfe");
  expect(mapped[0].createdAt).toBe(1794000000000);
  expect(mapped[0].updatedAt).toBe(1794063969594);
});

test("skills contract: a bare-id row (a minimal wire row) maps with honest defaults", () => {
  const row = { skills: [{ id: "skl-bare" }] };
  expect(() => assertContract("skills", row)).not.toThrow();
  const [v] = mapSkills(row.skills) as SkillRecord[];
  expect(v.id).toBe("skl-bare");
  expect(v.projectSlug).toBe(""); // the honest default — no fabrication
  expect(v.createdAt).toBe(0);
  expect(v.updatedAt).toBe(0);
});

test("skills contract: the F-2 fixture lane's camelCase hypothesis row is admitted (dual-form law)", () => {
  const row = {
    skills: [
      {
        id: "skl-camel",
        projectSlug: "agent-service-c5ccfe",
        createdAt: 1794000000000,
        updatedAt: 1794063969594,
      },
    ],
  };
  expect(() => assertContract("skills", row)).not.toThrow();
  const [v] = mapSkills(row.skills) as SkillRecord[];
  expect(v.projectSlug).toBe("agent-service-c5ccfe");
  expect(v.updatedAt).toBe(1794063969594);
});

test("skills contract: a NON-STRING id is drift (the anti-rot law is preserved)", () => {
  const row = { skills: [{ id: 42 }] };
  expect(() => assertContract("skills", row)).toThrow(EngineDrift);
});

test("skills contract: a missing skills array is drift", () => {
  expect(() => assertContract("skills", { bogus: [] })).toThrow(EngineDrift);
});

/* — the fixture server lane (the /api/skills route) — */

test("fixture server: GET /api/skills answers the honest empty table (V-41: no fake data)", async () => {
  const fixture = await makeFixture(true);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);
  const skills = await adapter.skills();
  expect(skills).toEqual([]); // the live truth — a fresh engine home
  await fixture.close();
});

test("fixture server: a scripted NON-empty skills payload round-trips through the real adapter", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);
  const payload = {
    skills: [
      { id: "skl-1", project_slug: "proj-a", created_at: 1000, updated_at: 2000 },
      { id: "skl-2" },
    ],
  };
  fixture.setPayload("skills", { status: 200, body: payload });
  const rows = await adapter.skills();
  expect(rows.length).toBe(2);
  expect(rows[0].id).toBe("skl-1");
  expect(rows[0].projectSlug).toBe("proj-a");
  expect(rows[1].projectSlug).toBe(""); // the honest default
  await fixture.close();
});

test("fixture server: a MUTATED skills payload (a non-string id) -> EngineDrift", async () => {
  const fixture = await makeFixture(false);
  const client = new EngineClient({ baseUrl: `http://127.0.0.1:${fixture.port}`, token: "t" });
  const adapter = clientAdapter(client);
  const mutated = { skills: [{ id: 7 }] };
  fixture.setPayload("skills", { status: 200, body: mutated });
  await expect(adapter.skills()).rejects.toThrow(EngineDrift);
  await fixture.close();
});

/* — the fake adapter's honest empty lane — */

test("fake adapter: the default skills lane is the honest empty table (a fresh engine home)", async () => {
  const fake = new FakeEngineAdapter(makeFakeClock(0).now);
  const skills = await fake.skills();
  expect(skills).toEqual([]);
});

test("fake adapter: a seeded skills row round-trips verbatim", async () => {
  const seeded: SkillRecord[] = [
    { id: "skl-seed", projectSlug: "s", createdAt: 1, updatedAt: 2 },
  ];
  const fake = new FakeEngineAdapter(makeFakeClock(0).now, { skills: seeded });
  const skills = await fake.skills();
  expect(skills).toEqual(seeded);
});
