// Parses a single line of CSV (comma-separated, with optional double-quoted
// fields that may contain commas and escaped quotes "") into an array of fields.
export function parseCsvLine(line) {
  // BUG: naive split breaks quoted fields
  return line.split(",");
}
