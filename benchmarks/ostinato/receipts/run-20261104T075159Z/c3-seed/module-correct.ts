/** roman.ts — Roman numeral parsing. */
const VAL: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romanToInt(s: string): number {
  const up = s.toUpperCase();
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = VAL[up[i]];
    if (v === undefined) throw new SyntaxError("bad roman: " + s);
    const next = VAL[up[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}
