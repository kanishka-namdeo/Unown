/** Rows are valid when: 3 columns [date, memo, amount]; amount parses as a number. */
export function validateRows(rows: string[][]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  rows.slice(1).forEach((row, i) => {
    if (row.length !== 3) errors.push(`row ${i + 1}: expected 3 columns, got ${row.length}`);
    if (row.length >= 3 && Number.isNaN(Number(row[2]))) errors.push(`row ${i + 1}: amount not a number`);
  });
  return { ok: errors.length === 0, errors };
}
