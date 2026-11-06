/**
 * local-storage test — acceptance (6): corrupt committed bytes →
 * load() null (no throw, no wipe), plus the atomic-save + orphaned-temp
 * recover lanes.
 */
import { test, expect } from "bun:test";
import {
  createLocalStorageAdapter,
  STORAGE_KEY,
  STORAGE_TMP_KEY,
} from "./local-storage.js";

type KV = Record<string, string>;

/** A StorageLike over a plain map. */
function storageLike(map: KV) {
  return {
    getItem(key: string): string | null {
      return key in map ? map[key] : null;
    },
    setItem(key: string, value: string): void {
      map[key] = value;
    },
    removeItem(key: string): void {
      delete map[key];
    },
  };
}

test("load: first boot (no committed key) → null", async () => {
  const map: KV = {};
  const port = createLocalStorageAdapter(storageLike(map));
  expect(await port.load()).toBeNull();
});

test("load: corrupt committed bytes → null, no throw, bytes intact (acceptance 6)", async () => {
  const map: KV = {};
  const port = createLocalStorageAdapter(storageLike(map));
  const corrupt = "{not valid json, whatever";
  map[STORAGE_KEY] = corrupt;
  const out = await port.load();
  expect(out).toBeNull();
  // the committed bytes are NOT wiped or rewritten
  expect(map[STORAGE_KEY]).toBe(corrupt);
});

test("load: valid committed bytes round-trip byte-losslessly", async () => {
  const map: KV = {};
  const port = createLocalStorageAdapter(storageLike(map));
  const bytes = '{"schema":"chaconne.v1","recipes":[],"runs":[]}';
  map[STORAGE_KEY] = bytes;
  expect(await port.load()).toEqual(JSON.parse(bytes));
});

test("save: atomic — temp first, commit second, temp cleaned", async () => {
  const map: KV = {};
  const writes: string[] = [];
  const like = {
    getItem: (k: string) => (k in map ? map[k] : null),
    setItem: (k: string, v: string) => {
      map[k] = v;
      writes.push(k);
    },
    removeItem: (k: string) => {
      delete map[k];
    },
  };
  const port = createLocalStorageAdapter(like);
  const bytes = '{"schema":"chaconne.v1"}';
  await port.save(null as never, bytes);
  // the lane: tmp → commit, then tmp cleanup
  expect(writes).toEqual([STORAGE_TMP_KEY, STORAGE_KEY]);
  expect(map[STORAGE_KEY]).toBe(bytes);
  expect(map[STORAGE_TMP_KEY]).toBeUndefined();
});

test("recover: orphaned temp from a crashed save is discarded", async () => {
  const map: KV = {};
  const port = createLocalStorageAdapter(storageLike(map));
  // simulate a crash between the temp write and the commit
  map[STORAGE_TMP_KEY] = '{"halfway":"there"}';
  const good = '{"schema":"chaconne.v1","recipes":[],"runs":[]}';
  map[STORAGE_KEY] = good;
  await port.recover();
  expect(map[STORAGE_TMP_KEY]).toBeUndefined();
  // the committed key survives untouched
  expect(map[STORAGE_KEY]).toBe(good);
  expect(await port.load()).toEqual(JSON.parse(good));
});

test("recover: no temp → no-op", async () => {
  const map: KV = {};
  const port = createLocalStorageAdapter(storageLike(map));
  await expect(port.recover()).resolves.toBeUndefined();
});
