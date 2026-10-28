/**
 * API tests for /cadence/api/habits — drive validateHabitPayload and the
 * POST/GET handlers directly with Request objects (same style as
 * src/lib/bazaar/orders-snapshot.test.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  GET,
  POST,
  validateHabitPayload,
} from "@/app/cadence/api/habits/route";
import type { Habit } from "@/lib/cadence/types";

function errMessages(
  r: { errors: string[]; ok: false } | { habit: Habit; ok: true },
): string[] {
  return "errors" in r ? r.errors : [];
}

// ── validateHabitPayload ──────────────────────────────────────────────────

describe("validateHabitPayload", () => {
  test("returns ok:false + errors when body is not an object", () => {
    const r = validateHabitPayload("not an object");
    expect(r.ok).toBe(false);
    expect(errMessages(r)).toContain("body must be a JSON object");
  });

  test("returns ok:false + errors when name is empty", () => {
    const r = validateHabitPayload({ name: "  ", frequency: { kind: "daily" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
  });

  test("returns ok:false + errors when frequency kind is unknown", () => {
    const r = validateHabitPayload({
      name: "Test habit",
      frequency: { kind: "monthly" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("frequency"))).toBe(true);
  });

  test("returns ok:false + errors when weekly target is out of range", () => {
    const r = validateHabitPayload({
      name: "Test habit",
      frequency: { kind: "weekly", target: 14 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("target"))).toBe(true);
  });

  test("returns ok:true with a habit when payload is valid (daily)", () => {
    const r = validateHabitPayload({
      name: "Meditate",
      glyph: "🧘",
      frequency: { kind: "daily" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.habit.name).toBe("Meditate");
    expect(r.habit.glyph).toBe("🧘");
    expect(r.habit.frequency).toEqual({ kind: "daily" });
    expect(r.habit.id).toMatch(/^hab-/);
  });

  test("returns ok:true with a habit when payload is valid (weekly target=3)", () => {
    const r = validateHabitPayload({
      name: "Gym",
      frequency: { kind: "weekly", target: 3 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.habit.frequency).toEqual({ kind: "weekly", target: 3 });
  });
});

// ── GET handler ───────────────────────────────────────────────────────────

describe("GET /cadence/api/habits", () => {
  test("returns 200 with the seeded habit list (stable order)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(6);
    // Stable order: same id on every call
    const res2 = await GET();
    const json2 = await res2.json();
    expect(json).toEqual(json2);
  });
});

// ── POST handler ──────────────────────────────────────────────────────────

describe("POST /cadence/api/habits", () => {
  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/cadence/api/habits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid JSON body");
  });

  test("returns 400 when name is missing", async () => {
    const req = new Request("http://localhost/cadence/api/habits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frequency: { kind: "daily" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
  });

  test("returns 400 when frequency kind is unknown", async () => {
    const req = new Request("http://localhost/cadence/api/habits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test", frequency: { kind: "yearly" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 201 with a created habit on valid payload", async () => {
    const req = new Request("http://localhost/cadence/api/habits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Run 5km",
        glyph: "🏃",
        frequency: { kind: "daily" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const habit = await res.json();
    expect(habit.name).toBe("Run 5km");
    expect(habit.glyph).toBe("🏃");
    expect(habit.id).toMatch(/^hab-/);
  });

  test("returns 400 for oversized body (Content-Length > 4096)", async () => {
    const big = "x".repeat(5000);
    const req = new Request("http://localhost/cadence/api/habits", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(5000),
      },
      body: `{"name":"${big}"}`,
    });
    const res = await POST(req);
    // The content-length check rejects before parsing.
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("body too large");
  });
});
