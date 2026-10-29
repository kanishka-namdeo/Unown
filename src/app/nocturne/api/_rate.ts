/**
 * The Nocturne API's shared rate-limit block (the aria/parley
 * `rateBuckets` pattern, with the >500-key sweep hard cap).
 *
 * Per-lambda-instance semantics — an honest bound, not a global one
 * (each Vercel instance carries its own module state). Applied to
 * every WRITE lane (login, the entity mutations, invites, reset);
 * GETs are untouched (read-only).
 */

const RATE_MAX = 50;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { start: number; count: number }>();

/**
 * True when the request's client IP has exceeded `RATE_MAX` writes
 * in the current window. The IP is the first `x-forwarded-for`
 * entry (or `x-real-ip`, or `local` when neither is present).
 */
export function writeLaneRateLimited(req: Request): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 500) {
      // Hard cap: wipe expired buckets, then drop the oldest half so
      // a spoofed x-forwarded-for flood cannot grow the map unbounded.
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

/**
 * Wipe the shared rate-limit buckets (test-lane convenience — the
 * `freshStore()` helper calls this so tests don't carry over 429s
 * from prior test files; plan §7/14). Not part of the public route
 * API.
 */
export function resetRateBuckets(): void {
  rateBuckets.clear();
}

/** The rate-limited 429 body (shared across the write lanes). */
export function rateLimitedBody(_what: string): { error: string; status: number } {
  return {
    error: "rate limited",
    status: 429,
  };
}

/** The bucket's ceiling (the 429-recovery test's pin target). */
export const RATE_MAX_EXPORT = RATE_MAX;
