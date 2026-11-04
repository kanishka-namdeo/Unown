/** daterange.ts — pure date-range helpers (UTC). */
export function daysInclusive(startIso: string, endIso: string): number {
  const a = Date.parse(startIso + "T00:00:00Z");
  const b = Date.parse(endIso + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) throw new RangeError("bad iso date");
  if (b < a) throw new RangeError("end before start");
  return Math.round((b - a) / 86400000);
}
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return daysInclusive(aStart, bEnd) >= 1 && daysInclusive(bStart, aEnd) >= 1 && daysInclusive(aStart, aEnd) >= 1 && daysInclusive(bStart, bEnd) >= 1;
}
