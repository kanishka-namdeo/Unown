/**
 * storage test — the Ostinato atomic-write law pins (E-07): temp-key +
 * commit-swap atomicity, corrupt-store typed error (NEVER a silent
 * wipe), and boot recovery that discards orphans while the committed
 * key survives.
 */
import { test, expect } from "bun:test";
import {
  load,
  save,
  recover,
  CorruptStoreError,
  type StorageLike,
} from "./storage.js";
import { emptyData, addJob } from "./model.js";
import { exportFugue } from "./io.js";

const NOW = 1762454400000; // 2026-11-07T00:00:00Z in epoch ms

type KV = Record<string, string>;

/** A StorageLike over a plain map, optionally recording the write lane. */
function storageLike(map: KV, writes?: string[]): StorageLike {
  return {
    getItem(key: string): string | null {
      return key in map ? map[key] : null;
    },
    setItem(key: string, value: string): void {
      if (writes) writes.push(`${key}=`);
      map[key] = value;
    },
    removeItem(key: string): void {
      if (writes) writes.push(`-${key}`);
      delete map[key];
    },
  };
}

test("load: first boot (no committed key) → null", () => {
  expect(load(storageLike({}))).toBeNull();
});

test("save: atomic commit-swap — temp first, commit second, temp cleaned", () => {
  const map: KV = {};
  const writes: string[] = [];
  const d = addJob(emptyData(), {
    title: "nightly", prompt: "summarize",
    schedule: { kind: "every", spec: "1d" },
    mode: "read-only", model: "m", timezone: "",
    misfire: "skip", spendCap: "off",
  }, NOW);
  const canonical = exportFugue(d.data);
  save(storageLike(map, writes), canonical);
  // the lane: tmp → commit, then tmp cleanup
  expect(writes[0]).toBe("fugue.temp.v1=");
  expect(writes[1]).toBe("fugue.committed.v1=");
  expect(writes[2]).toBe("-fugue.temp.v1");
  expect(map["fugue.committed.v1"]).toBe(canonical);
  expect(map["fugue.temp.v1"]).toBeUndefined();
});

test("save: stores the EXACT canonical bytes (byte-stability law)", () => {
  const map: KV = {};
  const d = addJob(emptyData(), {
    title: "t", prompt: "p",
    schedule: { kind: "once", delayMinutes: 1 },
    mode: "standard", model: "m", timezone: "",
    misfire: "catch-up", spendCap: 42,
  }, NOW);
  const canonical = exportFugue(d.data);
  save(storageLike(map), canonical);
  expect(map["fugue.committed.v1"]).toBe(canonical);
  const back = load(storageLike(map));
  expect(back).toEqual(d.data);
});

test("E-07: corrupt committed bytes → CorruptStoreError, bytes INTACT (never wiped)", () => {
  const map: KV = { "fugue.committed.v1": "{not valid json, whatever" };
  expect(() => load(storageLike(map))).toThrow(CorruptStoreError);
  // the committed bytes are NOT wiped or rewritten — the recovery panel
  // can export the wreckage
  expect(map["fugue.committed.v1"]).toBe("{not valid json, whatever");
  // a decodable-but-non-object committed value is corrupt too
  const map2: KV = { "fugue.committed.v1": "[1,2]" };
  expect(() => load(storageLike(map2))).toThrow(CorruptStoreError);
});

test("recover: an orphaned temp (crashed save) is discarded; no commit → null", () => {
  const map: KV = {
    "fugue.temp.v1": '{"halfway":"there"}',
  };
  recover(storageLike(map));
  expect(map["fugue.temp.v1"]).toBeUndefined();
  // no committed key: a crashed save before commit leaves nothing to load
  expect(load(storageLike(map))).toBeNull();
});

test("recover: orphan temp + healthy commit → the committed key survives intact", () => {
  const good = '{"schema":"fugue.v1","jobs":[],"runs":[],"nextId":0}';
  const map: KV = {
    "fugue.temp.v1": '{"halfway":"there"}',
    "fugue.committed.v1": good,
  };
  recover(storageLike(map));
  expect(map["fugue.temp.v1"]).toBeUndefined();
  expect(map["fugue.committed.v1"]).toBe(good);
  expect(load(storageLike(map))).toEqual({
    schema: "fugue.v1" as const, jobs: [], runs: [], nextId: 0,
  });
});

test("recover: no temp → no-op", () => {
  const map: KV = {};
  recover(storageLike(map));
  expect(Object.keys(map)).toEqual([]);
});
