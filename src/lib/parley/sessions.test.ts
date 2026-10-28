import { describe, expect, test } from "bun:test";
import { createSession, findSession, isExpired, makeSignedCookie, removeSession, SESSION_TTL_MS, verifyCookie, verifySignedCookie } from "./sessions";

const NOW = "2026-10-28T12:00:00Z";

describe("createSession", () => {
  test("sets expiresAt to now + 8h", () => {
    const row = createSession("u-mira", "t-lumen", NOW, () => 0.5);
    const expected = new Date(new Date(NOW).getTime() + SESSION_TTL_MS)
      .toISOString()
      .replace(".000Z", "Z");
    expect(row.expiresAt).toBe(expected);
  });

  test("carries userId and tenantId", () => {
    const row = createSession("u-mira", "t-lumen", NOW, () => 0.5);
    expect(row.userId).toBe("u-mira");
    expect(row.tenantId).toBe("t-lumen");
    expect(row.id).toMatch(/^ses-/);
  });

  test("TTL is exactly 8h in ms", () => {
    expect(SESSION_TTL_MS).toBe(8 * 3_600_000);
  });
});

describe("isExpired", () => {
  const row = createSession("u1", "t1", NOW, () => 0.5);

  test("not expired at creation time", () => {
    expect(isExpired(row, NOW)).toBe(false);
  });

  test("expired just after TTL", () => {
    const expiredAt = new Date(new Date(NOW).getTime() + SESSION_TTL_MS + 1_000)
      .toISOString()
      .replace(".000Z", "Z");
    expect(isExpired(row, expiredAt)).toBe(true);
  });

  test("not expired just before TTL", () => {
    const justBefore = new Date(new Date(NOW).getTime() + SESSION_TTL_MS - 1_000)
      .toISOString()
      .replace(".000Z", "Z");
    expect(isExpired(row, justBefore)).toBe(false);
  });
});

describe("removeSession / findSession", () => {
  test("removeSession returns a new array without the target", () => {
    const a = createSession("u1", "t1", NOW, () => 0.1);
    const b = createSession("u2", "t1", NOW, () => 0.2);
    const rows = [a, b];
    const after = removeSession(rows, a.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(b.id);
    // copy-on-write: original untouched
    expect(rows).toHaveLength(2);
  });

  test("findSession returns undefined for unknown id", () => {
    const a = createSession("u1", "t1", NOW, () => 0.1);
    expect(findSession([a], "ses-nonexistent")).toBeUndefined();
    expect(findSession([a], a.id)).toBe(a);
  });
});

describe("cookie signing", () => {
  test("makeSignedCookie + verifySignedCookie round-trip", () => {
    const sessionId = "ses-abc123-000001";
    const cookie = makeSignedCookie(sessionId);
    expect(verifySignedCookie(cookie)).toBe(sessionId);
  });

  test("a tampered signature is rejected", () => {
    const sessionId = "ses-abc123-000001";
    const cookie = makeSignedCookie(sessionId);
    const tampered = cookie.replace(/\.([0-9a-f]{8})/, ".$1ff"); // flip 2 hex chars
    // The signature is 64 hex chars — just replace the first 8 chars with a different prefix
    const [id, sig] = cookie.split(".");
    const badSig = "0".repeat(64);
    expect(verifySignedCookie(`${id}.${badSig}`)).toBe(null);
    expect(verifyCookie(id, badSig)).toBe(false);
  });

  test("a tampered session id is rejected (signature mismatch)", () => {
    const cookie = makeSignedCookie("ses-real-000001");
    const sig = cookie.split(".")[1];
    expect(verifySignedCookie(`ses-other-000001.${sig}`)).toBe(null);
  });

  test("verifyCookie returns true for a valid signature", () => {
    const sessionId = "ses-valid-000001";
    const sig = makeSignedCookie(sessionId).split(".")[1];
    expect(verifyCookie(sessionId, sig)).toBe(true);
  });

  test("malformed cookie strings return null", () => {
    expect(verifySignedCookie("")).toBe(null);
    expect(verifySignedCookie("noudot")).toBe(null);
    expect(verifySignedCookie(".deadbeef")).toBe(null);
  });
});
