import { describe, expect, test } from "bun:test";
import { cli, state, readJson, writeJson, exists, read } from "./_helpers";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

describe("feature 10 - persistent store v2", () => {
  test("entries persist across invocations", () => {
    const c = state();
    cli(["add", "2500", "food", "--date", "2026-01-02"], c);
    cli(["add", "800", "food", "--date", "2026-01-04"], c);
    const bal = cli(["balance"], c);
    expect(bal.code).toBe(0);
    expect(bal.stdout).toContain("33.00");
    const store = readJson(c, ".ledger/store.json");
    expect(store.version).toBe(2);
    expect(store.entries).toHaveLength(2);
    expect(store.entries[0].id).toBe("e-001");
  });

  test("v1 store (bare array) migrates in place to v2", () => {
    const c = state();
    writeJson(c, ".ledger/store.json", [
      { id: "e-001", date: "2026-01-02", amountCents: 2500, category: "food" },
    ]);
    const r = cli(["balance"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("25.00");
    const store = readJson(c, ".ledger/store.json");
    expect(store.version).toBe(2);
    expect(store.entries).toHaveLength(1);
  });

  test("store check validates without modifying", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    const r = cli(["store", "check"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("store ok");
    expect(r.stdout).toContain("1 entries");
  });

  test("corrupt store is a fatal store error", () => {
    const c = state();
    writeJson(c, ".ledger/store.json", { version: 7, entries: [] });
    const r = cli(["list"], c);
    expect(r.code).toBe(1);
    expect((r.stdout + r.stderr).startsWith("store error:") || (r.stdout + r.stderr).includes("store error:")).toBe(true);
  });

  test("bad JSON in the store is fatal", () => {
    const c = state();
    mkdirSync(join(c, ".ledger"), { recursive: true });
    writeFileSync(join(c, ".ledger", "store.json"), "{not json");
    const r = cli(["balance"], c);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("store error:");
  });

  test("undo still works against the store", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    cli(["add", "200", "rent", "--date", "2026-01-03"], c);
    expect(cli(["undo"], c).code).toBe(0);
    const store = readJson(c, ".ledger/store.json");
    expect(store.entries).toHaveLength(1);
    expect(cli(["balance"], c).stdout).toContain("1.00");
  });
});
