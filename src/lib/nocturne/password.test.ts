import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";
import { DEMO_PASSWORD } from "./types";

describe("password", () => {
  test("hash/verify round-trip succeeds with the correct password", () => {
    const salt = "s-nocturne-lumen-mira";
    const { hash } = hashPassword(DEMO_PASSWORD, salt);
    expect(verifyPassword(DEMO_PASSWORD, salt, hash)).toBe(true);
  });

  test("verify fails with a wrong password", () => {
    const { hash } = hashPassword(DEMO_PASSWORD, "s-x");
    expect(verifyPassword("wrong-password", "s-x", hash)).toBe(false);
    expect(verifyPassword("", "s-x", hash)).toBe(false);
  });

  test("different salts produce different hashes for the same password", () => {
    const a = hashPassword("same-password", "salt-a");
    const b = hashPassword("same-password", "salt-b");
    expect(a.hash).not.toBe(b.hash);
  });

  test("same password + same salt → same hash (deterministic)", () => {
    const a = hashPassword("demo", "s-fixed");
    const b = hashPassword("demo", "s-fixed");
    expect(a.hash).toBe(b.hash);
  });

  test("hash is a fixed-length hex string (64 chars = 32 bytes)", () => {
    const { hash } = hashPassword("anything", "s-test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a length-mismatched stored hash returns false without crashing", () => {
    expect(verifyPassword("x", "s", "00")).toBe(false);
    expect(verifyPassword("x", "s", "deadbeef")).toBe(false);
  });

  test("a corrupt (non-hex) digest returns false, never throws", () => {
    expect(verifyPassword("x", "s", "nothex!")).toBe(false);
    expect(verifyPassword("x", "s", "")).toBe(false);
  });

  test("the default salt is deterministic per password length", () => {
    const a = hashPassword("demo");
    const b = hashPassword("demo");
    expect(a.salt).toBe(b.salt);
    expect(verifyPassword("demo", a.salt, a.hash)).toBe(true);
  });

  test("a seeded user's hash verifies against DEMO_PASSWORD with the seed's fixed salt", () => {
    const salt = "s-nocturne-nw-ingrid";
    const { hash } = hashPassword(DEMO_PASSWORD, salt);
    expect(verifyPassword(DEMO_PASSWORD, salt, hash)).toBe(true);
    // and that the demo constant is the plan's literal
    expect(DEMO_PASSWORD).toBe("nocturne-demo-1");
  });

  test("two different passwords never share a digest under one salt", () => {
    const a = hashPassword("pass-one", "s-same");
    const b = hashPassword("pass-two", "s-same");
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword("pass-one", "s-same", b.hash)).toBe(false);
    expect(verifyPassword("pass-two", "s-same", a.hash)).toBe(false);
  });
});
