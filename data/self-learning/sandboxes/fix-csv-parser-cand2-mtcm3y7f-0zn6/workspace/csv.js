export function parseCsvLine(line) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      // Check if this is an escaped quote ("")
      if (i + 1 < line.length && line[i + 1] === '"') {
        currentField += '"';
        i += 2; // Skip the next quote
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field when not in quotes
      fields.push(currentField);
      currentField = '';
      i++;
    } else {
      // Regular character
      currentField += char;
      i++;
    }
  }
  
  // Add the last field
  fields.push(currentField);
  return fields;
}
