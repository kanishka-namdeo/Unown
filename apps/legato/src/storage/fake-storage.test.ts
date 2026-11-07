/**
 * fake-storage.ts tests — the in-memory StoragePort pins:
 * save/load round-trip, quota-error pin (S-2), interrupted-write
 * recover pin (S-3), export-mid-migration pin (S-4).
 */
import { test, expect } from "bun:test";
import type { LegatoData, Clip } from "../domain/types.js";
import { QuotaExceededError } from "../domain/types.js";
import { FakeStorage } from "./fake-storage.js";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    url: "https://example.com",
    title: "Example",
    text: "body",
    tags: ["a"],
    state: "unread",
    highlights: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

function makeData(clip: Partial<Clip> = {}): LegatoData {
  const c = makeClip(clip);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [c],
    tags: [...new Set(c.tags)],
    queue: [c.id],
  };
}

test("FakeStorage: save/load round-trip returns the same data", async () => {
  const fs = new FakeStorage();
  const data = makeData();
  await fs.save(data);
  const loaded = await fs.load();
  expect(loaded).toEqual(data);
});

test("FakeStorage: load on unseeded store returns null", async () => {
  const fs = new FakeStorage();
  expect(await fs.load()).toBeNull();
});

test("FakeStorage: constructor seed is deep-cloned (not live-ref)", async () => {
  const seed = makeData();
  const fs = new FakeStorage(seed);
  // Mutate the seed after construction — the store must not see it
  seed.clips[0].title = "MUTATED";
  const loaded = await fs.load();
  expect(loaded?.clips[0].title).toBe("Example");
});

test("FakeStorage: save does not mutate the input (deep copy)", async () => {
  const fs = new FakeStorage();
  const data = makeData();
  await fs.save(data);
  data.clips[0].title = "MUTATED";
  const loaded = await fs.load();
  expect(loaded?.clips[0].title).toBe("Example");
});

// --- S-2: quota-error pin — injected QuotaExceededError surfaces
// typed, never a silent loss ---

test("S-2: injected QuotaExceededError is thrown from save()", async () => {
  const fs = new FakeStorage();
  await fs.save(makeData()); // establish committed state first
  fs.injectQuotaFailure("disk full");
  await expect(fs.save(makeData({ title: "never lands" }))).rejects.toThrow(
    QuotaExceededError,
  );
});

test("S-2: quota failure does not corrupt the committed state", async () => {
  const fs = new FakeStorage();
  await fs.save(makeData());
  fs.injectQuotaFailure();
  try {
    await fs.save(makeData({ title: "never lands" }));
  } catch {
    /* expected */
  }
  const loaded = await fs.load();
  expect(loaded?.clips[0]?.id).toBe(1); // original data intact
  expect(loaded?.clips[0]?.title).toBe("Example");
});

test("S-2: the thrown error carries the injected message and name", async () => {
  const fs = new FakeStorage();
  fs.injectQuotaFailure("quota pin message");
  let caught: unknown = null;
  try {
    await fs.save(makeData());
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(QuotaExceededError);
  expect((caught as Error).name).toBe("QuotaExceededError");
  expect((caught as Error).message).toBe("quota pin message");
});

test("S-2: injected failure is one-shot (next save succeeds)", async () => {
  const fs = new FakeStorage();
  fs.injectQuotaFailure();
  try {
    await fs.save(makeData({ title: "never lands" }));
  } catch {
    /* expected */
  }
  const data = makeData({ title: "lands" });
  await fs.save(data); // no injection set → clean save
  expect(await fs.load()).toEqual(data);
});

// --- S-3: interrupted-write recover pin — a save that dies mid-write
// leaves the store loadable (the pre-interruption commit survives) ---

test("S-3: interrupted save leaves the pre-interruption commit loadable", async () => {
  const fs = new FakeStorage();
  await fs.save(makeData({ title: "v1" }));

  fs.injectInterruptedWrite();
  await fs.save(makeData({ title: "v2" })); // dies after the temp — commit skipped

  // The store must still load the last GOOD commit (v1), not v2
  const loaded = await fs.load();
  expect(loaded?.clips[0]?.title).toBe("v1");

  // recover() discards the orphaned temp; the store remains loadable
  await fs.recover();
  const after = await fs.load();
  expect(after?.clips[0]?.title).toBe("v1");
});

test("S-3: after recover, a fresh save succeeds (store is usable)", async () => {
  const fs = new FakeStorage();
  await fs.save(makeData({ title: "v1" }));
  fs.injectInterruptedWrite();
  await fs.save(makeData({ title: "v2" }));
  await fs.recover();
  const data = makeData({ title: "v3" });
  await fs.save(data); // clean save after recovery
  expect((await fs.load())?.clips[0]?.title).toBe("v3");
});

test("S-3: interrupt is one-shot (next save commits normally)", async () => {
  const fs = new FakeStorage();
  await fs.save(makeData({ title: "seed" }));
  fs.injectInterruptedWrite();
  await fs.save(makeData({ title: "interrupted" })); // interrupted
  const data = makeData({ title: "b" });
  await fs.save(data); // no injection → commit
  expect((await fs.load())?.clips[0]?.title).toBe("b");
});

// --- S-4: export-mid-migration pin — load during a pending migration
// returns the pre-migration view, never a mix ---

test("S-4: load during a pending migration returns the pre-migration view", async () => {
  const fs = new FakeStorage();
  const pre = makeData({ title: "pre-migration" });
  await fs.save(pre);

  fs.__setMigrating(true);
  const during = await fs.load();
  expect(fs.isMigrating()).toBe(true);
  expect(during).toEqual(pre); // the pre-migration view, never a torn mix

  fs.__setMigrating(false);
  expect(fs.isMigrating()).toBe(false);
});

test("S-4: load during a migration on an unseeded store returns null", async () => {
  const fs = new FakeStorage();
  fs.__setMigrating(true);
  expect(await fs.load()).toBeNull();
  fs.__setMigrating(false);
});

test("StoragePort: FakeStorage implements the interface shape", () => {
  const fs: import("./storage-port.js").StoragePort = new FakeStorage();
  expect(typeof fs.load).toBe("function");
  expect(typeof fs.save).toBe("function");
  expect(typeof fs.recover).toBe("function");
  expect(typeof fs.isMigrating).toBe("function");
});
