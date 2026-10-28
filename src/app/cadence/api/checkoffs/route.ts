import { NextResponse } from "next/server";
import { seedState } from "@/lib/cadence/persistence";
import type { CheckoffDate } from "@/lib/cadence/types";

// GETs read module-scope in-memory state that POSTs mutate — without this
// a Vercel production build would serve the first GET response forever.
export const dynamic = "force-dynamic";

// ── Seeded state (deterministic, no clock) ────────────────────────────────
const seed = seedState(new Date("2000-01-01T00:00:00Z"));

/** Stable seeded entries map, returned by GET. */
const seededEntries: Record<string, CheckoffDate[]> = seed.entries;

/** All known habit ids (seeded + any accepted via POST /cadence/api/habits). */
const knownHabitIds: Set<string> = new Set(Object.keys(seededEntries));

// ── Rate limit (copy of the bazaar rateBuckets block) ─────────────────────
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

// ── Date validation ────────────────────────────────────────────────────────

/**
 * A valid checkoff date is a `YYYY-MM-DD` string that is not in the future
 * (relative to `now`, which defaults to the server clock).
 */
export function isValidCheckoffDate(
  date: unknown,
  now: Date = new Date(),
): date is CheckoffDate {
  if (typeof date !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // Parse as a UTC day key and reject anything after today.
  const t = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  const todayMidnight = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  return t <= todayMidnight;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(seededEntries);
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

  const obj = body as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return NextResponse.json(
      { error: "validation failed", errors: ["body must be a JSON object"] },
      { status: 400 },
    );
  }

  const habitId = String(obj.habitId ?? "");
  if (!habitId) {
    return NextResponse.json(
      { error: "validation failed", errors: ["habitId is required"] },
      { status: 400 },
    );
  }

  if (!knownHabitIds.has(habitId)) {
    return NextResponse.json(
      { error: "unknown habit", errors: [`habitId "${habitId}" is not a known habit`] },
      { status: 400 },
    );
  }

  const date = obj.date;
  if (!isValidCheckoffDate(date)) {
    return NextResponse.json(
      {
        error: "invalid date",
        errors: ["date must be a YYYY-MM-DD string that is not in the future"],
      },
      { status: 400 },
    );
  }

  const existing = seededEntries[habitId];

  // Demo-scoped history cap: seeded habits carry ~270 distinct dates, so a
  // habit that reaches 400 distinct checkoff dates is full.
  if (existing.length >= 400) {
    return NextResponse.json(
      { error: "habit history full", errors: [`habit ${habitId} is at the ${400}-date demo cap`] },
      { status: 400 },
    );
  }

  // Copy-on-write upsert: never mutate the seeded array in place — the GET
  // lane must keep serving stable data while POSTs accumulate.
  if (!existing.includes(date)) {
    seededEntries[habitId] = [...existing, date];
  }

  return NextResponse.json(
    { habitId, date, entries: seededEntries[habitId] },
    { status: 201 },
  );
}
