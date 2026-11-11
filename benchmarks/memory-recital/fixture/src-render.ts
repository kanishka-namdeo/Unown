/** Render validated rows as a fixed-width table. */
export function renderTable(rows: string[][]): string {
  const widths = [10, 24, 12];
  const head = rows[0].map((h, i) => h.padEnd(widths[i])).join(" | ");
  const body = rows.slice(1).map((row) => row.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | "));
  return [head, ...body].join("\n");
}
