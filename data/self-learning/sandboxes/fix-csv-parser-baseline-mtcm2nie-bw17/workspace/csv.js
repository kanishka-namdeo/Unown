// Parses a single line of CSV (comma-separated, with optional double-quoted
// fields that may contain commas and escaped quotes "") into an array of fields.
export function parseCsvLine(line) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote - add one quote and skip next character
        currentField += '"';
        i++; // skip the next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field (not in quotes)
      fields.push(currentField);
      currentField = '';
    } else {
      // Regular character
      currentField += char;
    }
  }
  
  // Add the last field
  fields.push(currentField);
  return fields;
}
