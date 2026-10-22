/**
 * _fake-platform.ts — the deterministic in-memory MemoryPlatform for tests.
 *
 * Simulates the mem0 surface the engine consumes (add/getAll/search/delete/
 * update) with no LLM, no network, no native addons: add() "extracts" one
 * atomic memory per input line (deterministic split), delete/update mutate
 * the store, and search() scores by naive token overlap. Every operation is
 * recorded for assertions (calls, addedEvents).
 *
 * This is the platform seam's contract test double: dream/harness/seed tests
 * inject it via opts.platform / setMemoryPlatformForTests.
 */
import type { MemoryPlatform, MemoryPlatformEvent, MemoryScope, PlatformMemory } from "../src/memzero.ts";

export interface FakePlatformRecord {
	op: "add" | "delete" | "update" | "getAll" | "search";
	input?: string;
	id?: string;
	scope?: MemoryScope;
	metadata?: Record<string, any>;
	infer?: boolean;
}

export interface FakePlatform extends MemoryPlatform {
	/** Every platform operation, in order (assertions). */
	calls: FakePlatformRecord[];
	/** Direct store manipulation for seeding. */
	seed(memories: Array<Partial<PlatformMemory>>): void;
	/** The live store (id -> memory). */
	store: Map<string, PlatformMemory>;
}

let counter = 0;

export function makeFakePlatform(opts: {
	/**
	 * The extraction function: how add() turns input text into atomic
	 * memories. Default: one memory per non-empty line (trimmed), skipping
	 * lines that look like section headers.
	 */
	extract?: (text: string) => string[];
} = {}): FakePlatform {
	const extract =
		opts.extract ??
		((text: string) =>
			String(text ?? "")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---")));
	const memories = new Map<string, PlatformMemory>();
	const calls: FakePlatformRecord[] = [];
	const platform: FakePlatform = {
		backend: "lexical-fake",
		calls,
		store: memories,
		seed(list) {
			for (const m of list) {
				const id = m.id ?? `seed-${++counter}`;
				memories.set(id, {
					id,
					text: m.text ?? "",
					updatedAt: m.updatedAt ?? new Date().toISOString(),
					createdAt: m.createdAt ?? new Date().toISOString(),
					metadata: m.metadata ?? { kind: "legacy" },
				});
			}
		},
		async add(text, scope, metadata = {}, addOpts = {}) {
			calls.push({ op: "add", input: typeof text === "string" ? text : JSON.stringify(text), scope, metadata, infer: addOpts.infer });
			const inputs = typeof text === "string" ? [text] : text.map((m) => m.content);
			const events: MemoryPlatformEvent[] = [];
			const scoped = { ...metadata };
			if (scope.agentId) scoped.agent_id = scope.agentId;
			if (scope.userId) scoped.user_id = scope.userId;
			if (scope.runId) scoped.run_id = scope.runId;
			for (const input of inputs) {
				for (const line of extract(input)) {
					const id = `mem-${++counter}`;
					const now = new Date().toISOString();
					memories.set(id, {
						id,
						text: line,
						createdAt: now,
						updatedAt: now,
							metadata: { ...scoped },
					});
					events.push({ event: "ADD", id, text: line });
				}
			}
			return events;
		},
		async getAll(scope) {
			calls.push({ op: "getAll", scope });
			return [...memories.values()].filter((m) => scopeMatches(m.metadata ?? {}, scope));
		},
		async search(query, scope, limit = 8) {
			calls.push({ op: "search", input: query, scope });
			const qTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
			return [...memories.values()]
				.filter((m) => scopeMatches(m.metadata ?? {}, scope))
				.map((m) => ({
					...m,
					score: [...qTokens].filter((t) => m.text.toLowerCase().includes(t)).length / Math.max(1, qTokens.size),
				}))
				.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
				.slice(0, limit);
		},
		async delete(id) {
			calls.push({ op: "delete", id });
			memories.delete(id);
		},
		async update(id, text) {
			calls.push({ op: "update", id, input: text });
			const m = memories.get(id);
			if (m) {
				m.text = text;
				m.updatedAt = new Date().toISOString();
			}
		},
	};
	return platform;
}

function scopeMatches(metadata: Record<string, any>, scope: MemoryScope): boolean {
	if (scope.agentId !== undefined && metadata.agent_id !== scope.agentId) return false;
	if (scope.userId !== undefined && metadata.user_id !== scope.userId) return false;
	// fake platform stores scope on the memory metadata at add time
	if (scope.agentId === undefined && scope.userId === undefined) return true;
	return true;
}
