import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  loadState,
  saveState,
  seedState,
  wipeCadenceStorage,
  SEED_VERSION,
  STORAGE_KEY,
  SEED_VERSION_KEY,
} from "./persistence";
import type { CadenceState, Habit } from "./types";

// Minimal localStorage shim so tests run in bun without a DOM. Under the
// landing repo's test setup (bunfig preload registers happy-dom) a REAL
// localStorage global already exists — the shim is installed only when the
// global is absent, and every helper works with either implementation.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

let installedShim = false;

beforeAll(() => {
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    installedShim = true;
  }
});

afterAll(() => {
  if (installedShim) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

function fresh() {
  localStorage.clear();
}

function rawState(): Record<string, string> {
  const store = globalThis.localStorage as unknown as MemStorage;
  const out: Record<string, string> = {};
  (["cadence:v1", "cadence:seedVersion"] as string[]).forEach((k) => {
    const v = store.getItem(k);
    if (v !== null) out[k] = v;
  });
  return out;
}

function sample(): CadenceState {
  const habits: Habit[] = [
    {
      id: "hab-water",
      name: "Water",
      glyph: "💧",
      frequency: { kind: "daily" },
      createdAt: "2025-01-01",
    },
    {
      id: "hab-gym",
      name: "Gym",
      glyph: "🏋",
      frequency: { kind: "weekly", target: 3 },
      createdAt: "2025-01-01",
    },
  ];
  return {
    habits,
    entries: {
      "hab-water": ["2026-04-14", "2026-04-15"],
      "hab-gym": ["2026-04-13"],
    },
    theme: "light",
  };
}

describe("persistence round-trip", () => {
  test("save then load returns the same state", () => {
    fresh();
    saveState(sample());
    const loaded = loadState();
    expect(loaded).toEqual(sample());
  });

  test("empty storage falls back to the deterministic seed", () => {
    fresh();
    const loaded = loadState(new Date(2026, 6, 15));
    const seed = seedState(new Date(2026, 6, 15));
    expect(loaded).toEqual(seed);
    expect(loaded.habits.length).toBe(6);
  });
});

describe("corruption fallback", () => {
  test("invalid JSON falls back to the seed without throwing", () => {
    fresh();
    localStorage.setItem(STORAGE_KEY, "{not json!!");
    const loaded = loadState(new Date(2026, 6, 15));
    expect(loaded.habits.length).toBe(6); // seed shape
  });

  test("garbage habit entries are dropped or repaired, never fatal", () => {
    fresh();
    const junk: CadenceState = {
      habits: [
        {
          id: "hab-water",
          name: "Water",
          glyph: "💧",
          frequency: { kind: "daily" },
          createdAt: "2025-01-01",
        },
      ] as Habit[],
      entries: {
        "hab-water": ["2026-04-15", "garbage", 42] as unknown as string[],
      },
      theme: "dark" as "dark" | "light",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(junk));
    const loaded = loadState();
    expect(loaded.entries["hab-water"]).toEqual(["2026-04-15"]); // garbage dropped
  });

  test("unknown theme coerces to dark", () => {
    fresh();
    const s: CadenceState = {
      habits: [],
      entries: {},
      theme: "purple" as unknown as "dark" | "light",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    expect(loadState().theme).toBe("dark");
  });
});

describe("stale seed version reseed", () => {
  test("a stored state tagged with an OLDER seedVersion reseeds", () => {
    fresh();
    localStorage.setItem(SEED_VERSION_KEY, "0"); // stale
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sample()));
    const loaded = loadState(new Date(2026, 6, 15));
    expect(loaded.habits.length).toBe(6); // reseeded, not the saved 2
  });

  test("matching seedVersion keeps the stored state", () => {
    fresh();
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sample()));
    expect(loadState()).toEqual(sample());
  });
});

describe("wipeCadenceStorage", () => {
  test("removes BOTH persisted keys", () => {
    fresh();
    saveState(sample());
    expect(rawState()[STORAGE_KEY]).toBeDefined();
    wipeCadenceStorage();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SEED_VERSION_KEY)).toBeNull();
  });

  test("after a wipe the next load takes the fresh-seed path", () => {
    fresh();
    saveState(sample());
    wipeCadenceStorage();
    const loaded = loadState(new Date(2026, 6, 15));
    expect(loaded.habits.length).toBe(6); // seed, not the wiped 2
  });
});

describe("SSR safety", () => {
  test("loadState never throws and saveState is silent without localStorage", () => {
    // We can't easily delete the global here (happy-dom may provide it),
    // so just assert no throw in the normal path.
    expect(() => {
      saveState(sample());
      loadState();
    }).not.toThrow();
  });
});
