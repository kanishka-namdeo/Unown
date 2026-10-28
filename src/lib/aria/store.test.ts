import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import {
  loadState,
  nextId,
  resetState,
  saveState,
  retainMailbox,
  _resetCacheForTests,
  MAILBOX_RETENTION,
  STATE_VERSION,
} from "./store";
import { seedAria } from "./seed";
import type { AriaMailboxMessage, AriaState } from "./types";

const DATA_DIR = join(process.cwd(), "data", "aria");
const STATE_FILE = join(DATA_DIR, "state.json");

beforeEach(() => {
  // Wipe the data dir so each test starts fresh, then let loadState reseed.
  rmSync(DATA_DIR, { recursive: true, force: true });
  _resetCacheForTests();
});

afterAll(() => {
  // Leave the working tree clean: the data dir is gitignored runtime state,
  // but a stray state.json is harmless either way — keep what the last
  // test's reseed produced.
});

function mailboxMsg(
  tenantId: string,
  at: string,
  id: string,
): AriaMailboxMessage {
  return {
    id,
    tenantId,
    enrollmentId: null,
    contactId: "c",
    subject: "s",
    body: "b",
    at,
    outcome: "sent",
  };
}

describe("loadState", () => {
  test("seeds on fresh boot (file absent)", () => {
    const s = loadState();
    expect(s.version).toBe(1);
    expect(s.tenants).toHaveLength(2);
    expect(s.deals).toHaveLength(18);
    expect(s.users).toHaveLength(8);
  });

  test("reseeds on version mismatch", () => {
    loadState();
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AriaState;
    raw.version = 99 as never;
    writeFileSync(STATE_FILE, JSON.stringify(raw));
    _resetCacheForTests();
    const s2 = loadState();
    expect(s2.version).toBe(STATE_VERSION);
    expect(s2.deals.length).toBeGreaterThan(0);
  });

  test("reseeds on corrupt JSON", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, "{{{not json", "utf-8");
    _resetCacheForTests();
    const s = loadState();
    expect(s.version).toBe(1);
    expect(s.tenants.length).toBe(2);
  });

  test("reseeds on structurally mangled state at the current version", () => {
    loadState();
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AriaState;
    (raw as unknown as Record<string, unknown>).deals = "not-an-array";
    writeFileSync(STATE_FILE, JSON.stringify(raw));
    _resetCacheForTests();
    const s2 = loadState();
    expect(Array.isArray(s2.deals)).toBe(true);
    expect(s2.deals.length).toBe(18);
  });

  test("prunes over-retention mailbox rows on boot (read path)", () => {
    loadState();
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AriaState;
    for (let i = 0; i < MAILBOX_RETENTION + 5; i++) {
      raw.mailbox.push(
        mailboxMsg("aria-tn-lumen", `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`, `m-${i}`),
      );
    }
    writeFileSync(STATE_FILE, JSON.stringify(raw));
    _resetCacheForTests();
    const s2 = loadState();
    const lumenMsgs = s2.mailbox.filter((m) => m.tenantId === "aria-tn-lumen");
    expect(lumenMsgs.length).toBe(MAILBOX_RETENTION);
  });

  test("a cached load returns the same reference", () => {
    const a = loadState();
    const b = loadState();
    expect(a).toBe(b);
  });
});

describe("saveState", () => {
  test("saveState throws when loadState was never called", () => {
    _resetCacheForTests();
    rmSync(DATA_DIR, { recursive: true, force: true });
    expect(() => saveState()).toThrow(/loadState/);
  });

  test("atomic write: state.json.tmp is renamed (no leftover tmp)", () => {
    loadState();
    saveState();
    expect(existsSync(`${STATE_FILE}.tmp`)).toBe(false);
    expect(existsSync(STATE_FILE)).toBe(true);
  });

  test("the on-disk document matches the in-memory state", () => {
    loadState();
    const onDisk = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AriaState;
    const s = loadState();
    expect(onDisk.deals).toEqual(s.deals);
    expect(onDisk.seq).toBe(s.seq);
  });
});

describe("nextId", () => {
  test("generates sequential ids and persists the counter", () => {
    loadState();
    const startSeq = loadState().seq;
    const id1 = nextId("acr");
    const id2 = nextId("act");
    expect(id1).toBe(`acr_${startSeq}`);
    expect(id2).toBe(`act_${startSeq + 1}`);
    expect(loadState().seq).toBe(startSeq + 2);
  });

  test("the id is `${prefix}_${seq}` exactly", () => {
    loadState();
    const startSeq = loadState().seq;
    expect(nextId("adeal")).toBe(`adeal_${startSeq}`);
  });

  test("counter survives a cache reset (re-read from disk)", () => {
    loadState();
    const startSeq = loadState().seq;
    const id = nextId("acr");
    _resetCacheForTests();
    const s2 = loadState();
    expect(id).toBe(`acr_${s2.seq - 1}`);
    expect(s2.seq).toBe(startSeq + 1);
  });
});

describe("resetState", () => {
  test("resets to a fresh seed (the file is wiped)", () => {
    loadState();
    nextId("acr"); // advance the counter
    resetState();
    const s = loadState();
    expect(s.seq).toBe(seedAria().seq);
  });

  test("two resets deep-equal (the embed-reset pin)", () => {
    loadState();
    nextId("acr");
    nextId("act");
    resetState();
    const a = loadState();
    resetState();
    const b = loadState();
    expect(a).toEqual(b);
  });

  test("the file is recreated on reset", () => {
    loadState();
    resetState();
    expect(existsSync(STATE_FILE)).toBe(true);
  });
});

describe("retainMailbox (pure)", () => {
  test("keeps the latest N per tenant, newest ordering by at then id", () => {
    const msgs: AriaMailboxMessage[] = [];
    for (let i = 0; i < MAILBOX_RETENTION + 10; i++) {
      msgs.push(mailboxMsg("t1", `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`, `m${i}`));
    }
    msgs.push(mailboxMsg("t2", "2026-01-01T00:00:00Z", "x1"));
    const kept = retainMailbox(msgs);
    expect(kept.filter((m) => m.tenantId === "t1")).toHaveLength(MAILBOX_RETENTION);
    expect(kept.filter((m) => m.tenantId === "t2")).toHaveLength(1);
    // the oldest t1 rows were pruned: m0..m9 gone, m10+ kept
    expect(kept.filter((m) => m.id === "m0").length).toBe(0);
    expect(kept.filter((m) => m.id === "m59").length).toBe(1);
  });

  test("is deterministic (same input → same output)", () => {
    const msgs = Array.from({ length: 105 }, (_, i) =>
      mailboxMsg("t1", `2026-10-${String((i % 30) + 1).padStart(2, "0")}T0${i % 10}:00:00Z`, `m${i}`),
    );
    expect(JSON.stringify(retainMailbox(msgs))).toBe(JSON.stringify(retainMailbox([...msgs])));
  });

  test("does not mutate the input array", () => {
    const m1 = mailboxMsg("t1", "2026-10-01T00:00:00Z", "a");
    const m2 = mailboxMsg("t1", "2026-10-02T00:00:00Z", "b");
    const input = [m2, m1];
    retainMailbox(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});
