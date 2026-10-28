import { test, expect, beforeEach, describe } from "bun:test";
import {
  loadState,
  appendRun,
  retainRuns,
  nextId,
  saveState,
  resetState,
  _resetCacheForTests,
  RUN_RETENTION,
} from "./store";
import { seedState } from "./seed";
import type { Run, FugueState } from "./types";
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data", "fugue");
const STATE_FILE = join(DATA_DIR, "state.json");

beforeEach(() => {
  // Wipe the data dir so each test starts fresh, then let loadState reseed.
  rmSync(DATA_DIR, { recursive: true, force: true });
  resetState();
});

// Re-export for other test files that need it.
export { DATA_DIR };

function makeRun(seq: number, workspaceId = "ws_atlas", status: "passed" | "failed" = "passed", offsetDays = 0): Run {
  const base = new Date("2025-06-01T00:00:00.000Z").getTime() - offsetDays * 86400_000;
  const startedAt = new Date(base).toISOString();
  return {
    id: `run_test_${seq}`,
    flowId: "fl_test",
    workspaceId,
    status,
    startedAt,
    endedAt: new Date(base + 1000).toISOString(),
    payload: { text: "test" },
    attempts: [],
    notifications: [],
  };
}

test("loadState seeds on fresh boot", () => {
  const s = loadState();
  expect(s.workspaces.length).toBe(2);
  expect(s.flows.length).toBe(2);
  expect(s.runs.length).toBe(6);
  expect(s.users.length).toBe(1);
});

test("loadState reseeds on version mismatch", () => {
  // Load once to seed, then corrupt the version.
  loadState();
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  raw.version = 999;
  writeFileSync(STATE_FILE, JSON.stringify(raw, null, 2));
  resetState();
  const s2 = loadState();
  expect(s2.version).toBe(1);
});

test("loadState reseeds on corrupt JSON", () => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, "{{{not json", "utf-8");
  resetState();
  const s = loadState();
  expect(s.version).toBe(1);
  expect(s.workspaces.length).toBe(2);
});

test("retainRuns keeps latest 50 per workspace", () => {
  const runs: Run[] = [];
  // 55 runs in ws_a, 5 in ws_b
  for (let i = 1; i <= 55; i++) runs.push(makeRun(i, "ws_a", "passed", 0));
  for (let i = 1; i <= 5; i++) runs.push(makeRun(i + 100, "ws_b", "passed", 0));

  const kept = retainRuns(runs);
  expect(kept.length).toBe(55); // 50 + 5
  const wsA = kept.filter((r) => r.workspaceId === "ws_a");
  const wsB = kept.filter((r) => r.workspaceId === "ws_b");
  expect(wsA.length).toBe(RUN_RETENTION);
  expect(wsB.length).toBe(5);
});

test("retainRuns orders by startedAt, keeps newest N", () => {
  // 3 runs in same ws, different days
  const runs: Run[] = [
    makeRun(1, "ws_a", "passed", 3), // oldest
    makeRun(2, "ws_a", "passed", 2),
    makeRun(3, "ws_a", "passed", 1), // newest
    makeRun(4, "ws_a", "passed", 0), // newest
  ];
  const kept = retainRuns(runs).filter((r) => r.workspaceId === "ws_a");
  // Global order: startedAt asc
  expect(kept[0].id).toBe("run_test_1");
  expect(kept[3].id).toBe("run_test_4");
});

test("appendRun persists to disk with retention applied", () => {
  loadState();
  // seed has 6 runs; add 49 more to ws_atlas → should keep 50 for ws_atlas
  for (let i = 1; i <= 49; i++) {
    appendRun(makeRun(1000 + i, "ws_atlas", "passed", 0));
  }
  const s = loadState();
  const wsARuns = s.runs.filter((r) => r.workspaceId === "ws_atlas");
  expect(wsARuns.length).toBe(50);
  // All on disk
  const onDisk = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as FugueState;
  expect(onDisk.runs.length).toBe(s.runs.length);
});

test("nextId generates sequential ids and persists", () => {
  loadState();
  const id1 = nextId("fl");
  const id2 = nextId("fl");
  expect(id1).toBe(`fl_15`);
  expect(id2).toBe(`fl_16`);
  // seq persisted to disk
  const s = loadState();
  expect(s.seq).toBe(17);
});

test("seedState is byte-stable across calls", () => {
  const a = JSON.stringify(seedState());
  const b = JSON.stringify(seedState());
  expect(a).toBe(b);
});

test("loadState reseeds on schema-level corruption at the same version", () => {
  // Valid JSON + version 1 but a mangled shape must reseed, not be served
  // as-is (which would crash retainRuns/stats downstream).
  loadState();
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as FugueState;
  raw.runs = "not-an-array" as unknown as FugueState["runs"];
  writeFileSync(STATE_FILE, JSON.stringify(raw, null, 2));
  _resetCacheForTests(); // force loadState() to re-read the on-disk doc
  const s2 = loadState();
  expect(Array.isArray(s2.runs)).toBe(true);
  expect(s2.runs.length).toBe(6); // deterministically reseeded
});

test("loadState prunes over-retention runs on boot (read path)", () => {
  // A legacy document with >RUN_RETENTION runs in one workspace is pruned at
  // load time, not deferred to the first appendRun. We need to exceed the cap
  // *per workspace* (the retention bound), so push RUN_RETENTION+5 new runs
  // (all newer than the seed's runs for that ws) on top of the seed.
  loadState();
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as FugueState;
  for (let i = 0; i < RUN_RETENTION + 5; i++) {
    raw.runs.push(makeRun(i + 2000, "ws_atlas", "passed", 0));
  }
  writeFileSync(STATE_FILE, JSON.stringify(raw, null, 2));
  _resetCacheForTests(); // force loadState() to re-read the on-disk doc
  const s2 = loadState();
  const wsRuns = s2.runs.filter((r) => r.workspaceId === "ws_atlas");
  expect(wsRuns.length).toBe(RUN_RETENTION);
});

test("atomic write: state.json.tmp is renamed (no leftover tmp)", () => {
  loadState();
  appendRun(makeRun(9999, "ws_atlas", "passed", 0));
  // No .tmp file should remain after a successful write
  expect(existsSync(`${STATE_FILE}.tmp`)).toBe(false);
  expect(existsSync(STATE_FILE)).toBe(true);
});
