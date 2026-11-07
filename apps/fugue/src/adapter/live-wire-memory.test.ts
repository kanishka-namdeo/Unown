/**
 * live-wire-memory.test.ts — the F-7 chunk 2 live-wire pins
 * (the operator's verbatim captures, 2026-11-07).
 *
 * Each live body: the contract assert passes AND the mapper
 * (mapDreams / mapMemory) produces the adapter-native views with
 * the RAW string ids uncoerced (the governing tree's raw-passthrough
 * semantics). The fixture-lane regression pins keep the F-2 camelCase
 * forms passing both lanes (the V-24 law: both forms, neither deleted).
 */
import { test, expect } from "bun:test";
import {
  assertContract,
  DREAMS_LIVE_FIXTURE,
  MEMORY_LIVE_FIXTURE,
  MEMORY_HEALTH_LIVE_FIXTURE,
  MEMORY_PROJECTS_LIVE_FIXTURE,
  CONTRACT_FIXTURES,
} from "./contract.js";
import { mapDreams, mapMemory } from "./rest-adapter.js";
import type { DreamRecord, MemoryView } from "./engine-adapter.js";

/* — (a) GET /api/dreams: the verbatim live body passes the pin — */

test("live-wire: GET /api/dreams (verbatim operator capture) passes assertContract('dreams')", () => {
  assertContract("dreams", DREAMS_LIVE_FIXTURE);
});

test("live-wire: the live dream rows map to DreamRecord with raw string ids + the closed status vocabulary", () => {
  const rows = mapDreams(
    (DREAMS_LIVE_FIXTURE as unknown as { dreams: Record<string, unknown>[] }).dreams,
  );
  expect(rows.length).toBe(3);
  // Newest first: the running row (started_at 1794064500000) leads.
  const [running, done, gated] = rows;
  expect(running.id).toBe("c0ffee00-0000-4abc-9def-85ebe9ad0003");
  expect(running.status).toBe("running");
  expect(running.endedAt).toBeNull(); // the open run — never a fake 0
  expect(done.id).toBe("project-85ebe9ad-36eb-48e2-ac09-369231b6caea");
  expect(done.status).toBe("done");
  expect(done.startedAt).toBe(1794063969594);
  expect(done.endedAt).toBe(1794064145248);
  expect(done.notesIn).toBe(3);
  expect(done.entriesMerged).toBe(0);
  expect(done.entriesPruned).toBe(2);
  expect(done.entriesAdded).toBe(3);
  expect(done.output).toContain("# Project Memory");
  expect(gated.id).toBe("8f2b1c0e-1234-4abc-9def-85ebe9ad0002");
  expect(gated.status).toBe("gated"); // E-06: passed through honestly
});

test("live-wire: a live dream row with a null output maps to an honest empty string", () => {
  const [running] = mapDreams(
    (DREAMS_LIVE_FIXTURE as unknown as { dreams: Record<string, unknown>[] }).dreams,
  );
  expect(running.output).toBe("");
});

/* — (b) the F-2 fixture lane still passes both assertContract AND mapDreams — */

test("regression: the F-2 camelCase dream fixture passes assertContract('dreams') and mapDreams", () => {
  assertContract("dreams", { dreams: CONTRACT_FIXTURES.dreams });
  const rows = mapDreams(CONTRACT_FIXTURES.dreams as unknown as Record<string, unknown>[]);
  expect(rows.length).toBe(2);
  // The fixture's 'applied' spelling maps to the live 'done' (E-06:
  // the success badge), the 'gated' row stays GATED.
  const byStatus: Record<string, DreamRecord> = {};
  for (const r of rows) byStatus[r.status] = r;
  expect(byStatus["done"]?.id).toBe("1");
  expect(byStatus["gated"]?.id).toBe("2");
  expect(byStatus["gated"]?.output).toContain("deny-queue");
  // The fixture's single `at` lane becomes both start and end.
  expect(byStatus["done"]?.startedAt).toBe(byStatus["done"]?.endedAt);
});

/* — (c) GET /api/memory: the live tiers body — */

test("live-wire: GET /api/memory (verbatim operator capture) passes assertContract('memory')", () => {
  assertContract("memory", MEMORY_LIVE_FIXTURE);
});

test("live-wire: the live tiers map onto MemoryView.tiers (name/version/content)", () => {
  const view = mapMemory(
    (MEMORY_LIVE_FIXTURE as unknown as { tiers: Record<string, unknown>[] }).tiers,
    MEMORY_HEALTH_LIVE_FIXTURE as unknown,
  );
  expect(view.tiers.length).toBe(1);
  expect(view.tiers[0].tier).toBe("policy");
  expect(view.tiers[0].version).toBe(1);
  expect(view.tiers[0].content).toContain("Tier 0 — Policy");
  // The degraded health fields stay honest zeros for the minimal row
  // (the brief's tier omits chars/updatedAt; the mapper's fallback).
  expect(view.tiers[0].chars).toBe(0);
});

/* — (d) GET /api/memory/health: the live health + platform body — */

test("live-wire: GET /api/memory/health (verbatim operator capture) passes assertContract('memory-health')", () => {
  assertContract("memory-health", MEMORY_HEALTH_LIVE_FIXTURE);
});

test("live-wire: the health card data maps onto MemoryHealthView", () => {
  const view = mapMemory(
    (MEMORY_LIVE_FIXTURE as unknown as { tiers: Record<string, unknown>[] }).tiers,
    MEMORY_HEALTH_LIVE_FIXTURE as unknown,
  );
  const h = view.health;
  expect(h.memoryCount).toBe(5);
  expect(h.duplicateCount).toBe(0);
  expect(h.conflictCount).toBe(0);
  expect(h.warnings).toEqual([]);
  expect(h.lastReconcile).toBe(1794064205283);
  expect(h.available).toBe(true);
  expect(h.backend).toBe("lexical");
  expect(h.model).toBe("agnes-3.0-flash");
  expect(h.maxRendered).toBe(110);
});

/* — (e) the F-2 fixture lane for memories still passes both forms — */

test("regression: the F-2 memories fixture passes assertContract('memories') and maps to an honest view", () => {
  assertContract("memories", CONTRACT_FIXTURES.memories);
  const view = mapMemory(CONTRACT_FIXTURES.memories, undefined);
  // The fixture lane ({ tiers: 4, version: 3, healthy: true }) has no
  // tier CONTENT — the mapper's honest mapping: zero tiers + the
  // degraded health defaults (no invented numbers).
  expect(view.tiers.length).toBe(0);
  expect(view.health.available).toBe(false);
});

/* — (f) GET /api/memory/projects: the live terminal project tiers — */

test("live-wire: GET /api/memory/projects (verbatim operator capture) passes assertContract('memory-projects')", () => {
  assertContract("memory-projects", MEMORY_PROJECTS_LIVE_FIXTURE);
});

/* — (g) drift lanes: a mutated live body throws the dotted-path — */

test("drift: an out-of-vocabulary dream status on the live wire throws", () => {
  let err: unknown;
  try {
    assertContract("dreams", {
      dreams: [{ ...DREAMS_LIVE_FIXTURE.dreams[0], status: "applied-legacy" }],
    });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("dreams[0].status");
});

test("drift: a missing dream timestamp lane throws", () => {
  const { started_at, at, ...rest } = DREAMS_LIVE_FIXTURE.dreams[0] as Record<string, unknown>;
  let err: unknown;
  try {
    assertContract("dreams", { dreams: [{ ...rest }] });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("timestamp lane");
});

test("drift: a non-array memory health warnings field throws", () => {
  let err: unknown;
  try {
    assertContract("memory-health", {
      ...MEMORY_HEALTH_LIVE_FIXTURE,
      health: { ...MEMORY_HEALTH_LIVE_FIXTURE.health, warnings: "all-clear" },
    });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("health.warnings");
});
