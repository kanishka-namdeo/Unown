/**
 * API tests for /cadence/api/checkoffs — drive the POST/GET handlers and
 * isValidCheckoffDate directly with Request objects.
 */
import { describe, expect, test } from "bun:test";
import {
  GET,
  POST,
  isValidCheckoffDate,
} from "@/app/cadence/api/checkoffs/route";

// ── isValidCheckoffDate ───────────────────────────────────────────────────

describe("isValidCheckoffDate", () => {
  test("accepts a valid past YYYY-MM-DD date", () => {
    // 2020-06-15 is well in the past
    expect(isValidCheckoffDate("2020-06-15")).toBe(true);
  });

  test("rejects a malformed string", () => {
    expect(isValidCheckoffDate("06/15/2020")).toBe(false);
    expect(isValidCheckoffDate("not-a-date")).toBe(false);
  });

  test("rejects a non-string value", () => {
    expect(isValidCheckoffDate(123)).toBe(false);
    expect(isValidCheckoffDate(null)).toBe(false);
  });

  test("rejects a future date", () => {
    // 2099-01-01 is far in the future
    expect(isValidCheckoffDate("2099-01-01")).toBe(false);
  });

  test("accepts today's date (boundary)", () => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(isValidCheckoffDate(key, d)).toBe(true);
  });
});

// ── GET handler ───────────────────────────────────────────────────────────

describe("GET /cadence/api/checkoffs", () => {
  test("returns 200 with the seeded entries map (stable)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json).toBe("object");
    expect(Array.isArray(json)).toBe(false);
    // Each seeded habit id maps to an array of dates
    for (const [habitId, dates] of Object.entries(json)) {
      expect(Array.isArray(dates)).toBe(true);
      expect(typeof habitId).toBe("string");
    }
    // Stable: two calls give identical output
    const res2 = await GET();
    const json2 = await res2.json();
    expect(json).toEqual(json2);
  });
});

// ── POST handler ──────────────────────────────────────────────────────────

describe("POST /cadence/api/checkoffs", () => {
  test("returns 400 for unknown habitId", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ habitId: "hab-nonexistent", date: "2020-01-01" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("unknown habit");
  });

  test("returns 400 for malformed date", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ habitId: "hab-daily-water", date: "not-a-date" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid date");
  });

  test("returns 400 for a future date", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ habitId: "hab-daily-water", date: "2099-01-01" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 when habitId is missing", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2020-01-01" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 201 for a valid upsert (past date, known habit)", async () => {
    const req = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ habitId: "hab-daily-water", date: "2020-06-15" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.habitId).toBe("hab-daily-water");
    expect(json.date).toBe("2020-06-15");
    expect(Array.isArray(json.entries)).toBe(true);
    expect(json.entries).toContain("2020-06-15");
  });

  test("upsert is idempotent — posting the same date twice gives 201 both times", async () => {
    const body = JSON.stringify({ habitId: "hab-daily-water", date: "2019-03-15" });
    const req1 = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(201);

    const req2 = new Request("http://localhost/cadence/api/checkoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(201);

    // The entries array should contain the date exactly once
    const json2 = await res2.json();
    const count = json2.entries.filter((d: string) => d === "2019-03-15").length;
    expect(count).toBe(1);
  });
});
