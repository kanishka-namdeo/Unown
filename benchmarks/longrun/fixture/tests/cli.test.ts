import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";

describe("cli core", () => {
  test("add prints the new id", () => {
    const r = runCli(["add", "2500", "food"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("e-001");
  });

  test("list on an empty ledger prints a placeholder", () => {
    const r = runCli(["list"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("no entries");
  });

  test("balance of the empty ledger is 0.00", () => {
    const r = runCli(["balance"]);
    expect(r.code).toBe(0);
    expect(r.output).toBe("0.00");
  });

  test("unknown command exits 1 with a hint", () => {
    const r = runCli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("unknown command");
  });

  test("add with a missing argument is a usage error", () => {
    const r = runCli(["add", "100"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("usage:");
  });
});
