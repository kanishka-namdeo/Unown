/** Monotonic per-prefix id generator: n-001, n-002, u-001, ... */
const counters = new Map<string, number>();

export function nextId(prefix: string): string {
	const next = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, next);
	return `${prefix}-${String(next).padStart(3, "0")}`;
}

/** Reset all counters (used by tests for deterministic ids). */
export function resetIds(): void {
	counters.clear();
}
