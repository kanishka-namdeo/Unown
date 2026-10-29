import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  createSession,
  findSession,
  isExpired,
  makeSignedCookie,
  removeSession,
  verifyCookie,
  verifySignedCookie,
} from "./sessions";
import { SESSION_TTL_MS, HMAC_SECRET } from "./types";

const NOW = "2026-10-28T12:00:00Z";

describe("createSession", () => {
  test("sets expiresAt to now + 8h", () => {
    const row = createSession("u-mira", "t-lumen", NOW, 42);
    const expected = new Date(new Date(NOW).getTime() + SESSION_TTL_MS)
      .toISOString()
      .replace(".000Z", "Z");
    expect(row.expiresAt).toBe(expected);
  });

  test("carries userId and tenantId", () => {
    const row = createSession("u-mira", "t-lumen", NOW, 42);
    expect(row.userId).toBe("u-mira");
    expect(row.tenantId).toBe("t-lumen");
    expect(row.id).toBe("nc_ses_42");
  });

  test("TTL is exactly 8h in ms", () => {
    expect(SESSION_TTL_MS).toBe(8 * 3_600_000);
  });

  test("is deterministic given the same seq (two calls → equal rows)", () => {
    const a = createSession("u1", "t1", NOW, 7);
    const b = createSession("u1", "t1", NOW, 7);
    expect(a).toEqual(b);
    // different seq → different id, same shape
    const c = createSession("u1", "t1", NOW, 8);
    expect(c.id).not.toBe(a.id);
  });
});

describe("isExpired", () => {
  const row = createSession("u1", "t1", NOW, 1);

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

  test("expiring exactly at expiresAt is NOT expired (strict >)", () => {
    expect(isExpired(row, row.expiresAt)).toBe(false);
  });
});

describe("removeSession / findSession", () => {
  test("removeSession returns a new array without the target (copy-on-write)", () => {
    const a = createSession("u1", "t1", NOW, 1);
    const b = createSession("u2", "t1", NOW, 2);
    const rows = [a, b];
    const after = removeSession(rows, a.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(b.id);
    expect(rows).toHaveLength(2);
  });

  test("removeSession of an unknown id is a no-op", () => {
    const a = createSession("u1", "t1", NOW, 1);
    expect(removeSession([a], "nc_ses-nope")).toHaveLength(1);
  });

  test("findSession returns undefined for unknown ids, the row for known", () => {
    const a = createSession("u1", "t1", NOW, 1);
    expect(findSession([a], "nc_ses-nope")).toBeUndefined();
    expect(findSession([a], a.id)).toBe(a);
  });

  test("findSession does not cross tenants (id is the key, tenant is carried by the row)", () => {
    const a = createSession("u1", "t1", NOW, 1);
    expect(findSession([a], a.id)!.tenantId).toBe("t1");
  });
});

describe("cookie signing (HMAC)", () => {
  test("makeSignedCookie + verifySignedCookie round-trip", () => {
    const sessionId = "nc_ses-abc123-000001";
    const cookie = makeSignedCookie(sessionId);
    expect(verifySignedCookie(cookie)).toBe(sessionId);
  });

  test("a tampered signature is rejected", () => {
    const cookie = makeSignedCookie("nc_ses-real-000001");
    const [id] = cookie.split(".");
    expect(verifySignedCookie(`${id}."${"0".repeat(64)}"`)).toBe(null);
    expect(verifyCookie(id, "0".repeat(64))).toBe(false);
  });

  test("a tampered session id is rejected (signature mismatch)", () => {
    const cookie = makeSignedCookie("nc_ses-real-000001");
    const sig = cookie.split(".")[1];
    expect(verifySignedCookie(`nc_ses-other-000001.${sig}`)).toBe(null);
  });

  test("verifyCookie returns true for a valid signature", () => {
    const sig = makeSignedCookie("nc_ses-valid-000001").split(".")[1];
    expect(verifyCookie("nc_ses-valid-000001", sig)).toBe(true);
  });

  test("malformed cookie strings return null (never throw)", () => {
    expect(verifySignedCookie("")).toBe(null);
    expect(verifySignedCookie("noudot")).toBe(null);
    expect(verifySignedCookie(".deadbeef")).toBe(null);
    expect(verifySignedCookie("abc.")).toBe(null);
    expect(verifySignedCookie("abc.!!!")).toBe(null); // non-hex signature
  });

  test("the signature is the HMAC-SHA256 hex of the session id under HMAC_SECRET", () => {
    // Independent re-derivation: the demo secret is public-by-design,
    // so a test can re-sign and pin the byte shape.
    const sessionId = "nc_ses-pin-000001";
    const expected = createHmac("sha256", HMAC_SECRET).update(sessionId).digest("hex");
    expect(makeSignedCookie(sessionId)).toBe(`${sessionId}.${expected}`);
  });

  test("a different secret produces a different signature (the secret is bound)", () => {
    // signCookie is pinned to HMAC_SECRET; re-deriving with another
    // key must mismatch → verifyCookie false.
    const other = createHmac("sha256", "some-other-secret")
      .update("nc_ses-x")
      .digest("hex");
    expect(verifyCookie("nc_ses-x", other)).toBe(false);
  });
});
