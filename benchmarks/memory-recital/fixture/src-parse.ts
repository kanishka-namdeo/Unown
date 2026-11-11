/** Parse a ledger CSV text into rows. Header row required. */
export function parseLedger(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("ledger needs a header row and at least one data row");
  return lines.map((line) => line.split(","));
}
