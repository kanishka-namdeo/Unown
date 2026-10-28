import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  test("hash/verify round-trip succeeds with correct password", () => {
    const salt = "s-lumen-mira";
    const { hash } = hashPassword("parley-demo-1", salt);
    expect(verifyPassword("parley-demo-1", salt, hash)).toBe(true);
  });

  test("verify fails with wrong password", () => {
    const salt = "s-lumen-mira";
    const { hash } = hashPassword("parley-demo-1", salt);
    expect(verifyPassword("wrong-password", salt, hash)).toBe(false);
  });

  test("different salts produce different hashes for the same password", () => {
    const a = hashPassword("same-password", "salt-a");
    const b = hashPassword("same-password", "salt-b");
    expect(a.hash).not.toBe(b.hash);
  });

  test("hash is a fixed-length hex string (64 chars = 32 bytes)", () => {
    const { hash } = hashPassword("anything", "s-test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("length-mismatch stored hash returns false without crashing", () => {
    // An invalid hex string of wrong length should be handled gracefully.
    expect(verifyPassword("x", "s", "00")).toBe(false);
  });

  test("determinism: same password + same salt → same hash", () => {
    const a = hashPassword("demo", "s-fixed");
    const b = hashPassword("demo", "s-fixed");
    expect(a.hash).toBe(b.hash);
  });
});
