/** Zero-padded sequential entry ids: "e-001", "e-002", ... */
export function nextId(existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = /^e-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `e-${String(max + 1).padStart(3, "0")}`;
}
