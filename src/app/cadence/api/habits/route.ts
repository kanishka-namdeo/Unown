import { NextResponse } from "next/server";
import { seedState } from "@/lib/cadence/persistence";

// GETs read module-scope in-memory state that POSTs mutate — without this
// a Vercel production build would serve the first GET response forever.
export const dynamic = "force-dynamic";
import {
  HABIT_NAME_MAX,
  WEEKLY_GOAL_MAX,
  WEEKLY_GOAL_MIN,
  type Habit,
  type HabitFrequency,
} from "@/lib/cadence/types";

// ── Seeded state (deterministic, no clock) ────────────────────────────────
const seed = seedState(new Date("2000-01-01T00:00:00Z"));

/** Stable seeded habit list, returned by GET. */
const seededHabits: Habit[] = seed.habits;

// ── Rate limit (copy of the bazaar rateBuckets block) ─────────────────────
// Fixed-window counter per client IP: RATE_MAX writes per RATE_WINDOW_MS.
// Per-lambda-instance semantics — an honest bound, not a global one.
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { start: number; count: number }>();

function rateLimited(req: Request): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 500) {
      // Hard cap (new — bazaar only expired-then-dropped): wipe every bucket
      // whose last hit is older than the window; if still over 500, drop the
      // oldest half so a spoofed x-forwarded-for flood cannot grow it unbounded.
      for (const [k, v] of rateBuckets) {
        if (now - v.start >= RATE_WINDOW_MS) rateBuckets.delete(k);
      }
      if (rateBuckets.size > 500) {
        const half = [...rateBuckets.entries()].slice(0, 250);
        for (const [k] of half) rateBuckets.delete(k);
      }
    }
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

// ── Payload validation ─────────────────────────────────────────────────────

/**
 * Validate a raw habit-creation payload → { errors, ok: false } on failure,
 * or { habit, ok: true } with a ready-to-persist Habit on success.
 *
 * Reuses the domain-layer validators from src/lib/cadence/validation.ts
 * for name / glyph, and enforces the frequency shape here (the domain
 * validator takes weeklyTarget as a number; the API payload carries the
 * full frequency object, so we adapt).
 */
export function validateHabitPayload(raw: unknown):
  | { errors: string[]; ok: false }
  | { habit: Habit; ok: true } {
  const errors: string[] = [];
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return { errors: ["body must be a JSON object"], ok: false };
  }

  // name
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (name.length === 0) errors.push("name is required (1–60 chars)");
  else if (name.length > HABIT_NAME_MAX)
    errors.push(`name must be at most ${HABIT_NAME_MAX} characters`);

  // glyph (0–1 character allowed)
  const glyphRaw = obj.glyph;
  let glyph = "";
  if (typeof glyphRaw === "string") {
    const chars = Array.from(glyphRaw);
    if (chars.length > 1) errors.push("glyph must be a single character");
    else glyph = glyphRaw;
  } else if (glyphRaw !== undefined && glyphRaw !== null) {
    errors.push("glyph must be a string");
  }

  // frequency: { kind: "daily" } or { kind: "weekly", target: 1–7 }
  const freqRaw = obj.frequency;
  let frequency: HabitFrequency | null = null;
  if (
    typeof freqRaw === "object" &&
    freqRaw !== null &&
    "kind" in freqRaw
  ) {
    const f = freqRaw as Record<string, unknown>;
    if (f.kind === "daily") {
      frequency = { kind: "daily" };
    } else if (f.kind === "weekly") {
      const target = Number(f.target);
      if (!Number.isInteger(target) || target < WEEKLY_GOAL_MIN || target > WEEKLY_GOAL_MAX) {
        errors.push(`frequency.target must be an integer in ${WEEKLY_GOAL_MIN}–${WEEKLY_GOAL_MAX}`);
      } else {
        frequency = { kind: "weekly", target };
      }
    } else {
      errors.push('frequency.kind must be "daily" or "weekly"');
    }
  } else if (typeof freqRaw === "string" && freqRaw === "daily") {
    frequency = { kind: "daily" };
  } else {
    errors.push('frequency must be { kind: "daily" } or { kind: "weekly", target: 1–7 }');
  }

  if (errors.length > 0) return { errors, ok: false };

  const today = new Date();
  const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Generate a deterministic-safe id (Date.now() + process counter is fine
  // here; the API is stateless per-request, no cross-session uniqueness
  // guarantee needed — the client generates its own ids for its own state).
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "habit";
  const id = `hab-${slug}-${Date.now()}`;

  return {
    habit: { id, name, glyph, frequency: frequency!, createdAt: dayKey },
    ok: true,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(seededHabits);
}

const MAX_BODY_BYTES = 4096;

export async function POST(req: Request) {
  if (rateLimited(req)) {
    return NextResponse.json(
      {
        error: "rate limited",
        errors: [`too many posts — max ${RATE_MAX} per ${RATE_WINDOW_MS / 1000}s`],
      },
      { status: 429 },
    );
  }

  // 4 KB payload cap — reject oversized bodies early.
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "body too large", errors: [`body must be at most ${MAX_BODY_BYTES} bytes`] },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "body too large", errors: [`body must be at most ${MAX_BODY_BYTES} bytes`] },
        { status: 400 },
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const result = validateHabitPayload(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json(result.habit, { status: 201 });
}
