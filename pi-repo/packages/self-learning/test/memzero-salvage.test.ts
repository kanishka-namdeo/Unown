// Regression tests for the 2026-10-29 memzero bug round:
//
//   BUG A  — the level-3 extraction salvage lane in Mem0Platform.add: when
//            mem0's stock extraction stochastically returns zero (the live
//            benchmark's 33% miss), ONE compact governed chatJson extraction
//            recovers the note's knowledge through the infer:false verbatim
//            lane; a total miss is signaled on the bus, never silent.
//   BUG 2  — revertMemoryEvents' DELETE branch re-adds verbatim (infer:false)
//            and preserves the original memory kind, instead of re-running
//            the full extraction LLM on a rollback.
//   BUG 4  — renderFooterMatches / stripRenderFooterTimestamp: two renders of
//            the same memory set compare equal despite the footer timestamp
//            (dream.ts's idempotence checks should call this — the render
//            side owns the strip, the dream side owns the comparison).
//   BUG 5  — the embedder-backend switch records the new backend ONLY on a
//            full reindex; a partial pass keeps the old marker (next boot
//            retries) and emits mem0:reindex-partial.
//   BUG 11 — importLegacyMarkdown excludes the "## Manual notes" section:
//            hand-edited bullets are preserved by the RENDER, never imported
//            as platform memories (the duplicate-forever loop).
//
// No real mem0 platform, no network: the salvage LLM is injected via
// setSalvageLlmForTests, platforms are fakes (test/_fake-platform.ts and
// inline recorders), and the reindex cases drive the exported switch helper
// against the redirected test store.
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { bus } from "../src/bus.ts";
import { store } from "../src/store.ts";
import { modelFor } from "../src/llm.ts";
import {
	applyEmbedderBackendSwitch,
	importLegacyMarkdown,
	Mem0Platform,
	renderFooterMatches,
	renderProjectMemoryMarkdown,
	revertMemoryEvents,
	setSalvageLlmForTests,
	stripRenderFooterTimestamp,
	type MemoryPlatform,
} from "../src/memzero.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

// The LLM seam is process-global: every test that injects a fake must clear
// it, and the whole file clears it after each block to stay order-safe.
afterEach(() => {
	setSalvageLlmForTests(null);
});

// ------------------------------------------------------- BUG A: salvage lane

describe("Mem0Platform.add — level-3 salvage lane (BUG A)", () => {
	// A realistic terminal-session note: outcome header, a substantive body
	// (pitfall + remedy + verification, >80 chars after the strip) and the
	// metadata line that trips mem0's stock extraction into zero results.
	const NOTE = [
		"Terminal session outcome in /home/z/scratch/acme-api:",
		"Final outcome: Fixed dedupeRows in src/dedupe.ts — the function only did exact-match dedup, so CRLF line endings left \\r in the comparison key. Normalized each line before comparing; bun test passes 2/2. The suite is flaky under parallel runners — re-run with --runInBand when results look wrong.",
		"Session metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 5 tool call(s) (read, edit, bash), 1 min.",
	].join("\n");
	const SCOPE = { agentId: "project:acme" };

	/**
	 * A fake inner mem0 Memory mimicking the two result lanes of the real SDK:
	 * the infer lane (extraction) returns the live benchmark's stochastic
	 * zero {results: []}; the infer:false lane adds each message VERBATIM
	 * (mem0's addToVectorStore skips extraction entirely for infer === false).
	 */
	function makeStochasticInner() {
		const calls: Array<{ text: string; opts: any }> = [];
		let n = 0;
		const memory = {
			async add(text: any, opts: any = {}) {
				calls.push({ text: typeof text === "string" ? text : JSON.stringify(text), opts });
				if (opts?.infer === false) {
					const messages = Array.isArray(text) ? text : [{ role: "user", content: text }];
					return {
						results: messages
							.filter((m: any) => m.role !== "system")
							.map((m: any) => ({ id: `salv-${++n}`, memory: m.content, metadata: { event: "ADD" } })),
					};
				}
				return { results: [] }; // the stochastic zero (both extraction rounds)
			},
		};
		return { memory, calls };
	}

	test("0 events twice → salvage fires: memories inserted verbatim (infer:false, salvage metadata), real events returned", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		const llmCalls: Array<{ messages: any; opts: any }> = [];
		const salvaged = [
			"Normalize CRLF line endings before deduplicating rows in src/dedupe.ts",
			"Suite is flaky under parallel runners — re-run with bun test --runInBand when results look wrong",
		];
		setSalvageLlmForTests(async (messages, opts) => {
			llmCalls.push({ messages, opts });
			return { memories: salvaged };
		});
		const events = await platform.add(NOTE, SCOPE, { kind: "note" });
		// the two salvage memories came back as REAL events (dreams see them)
		expect(events.map((e) => e.text)).toEqual(salvaged);
		expect(events.every((e) => e.event === "ADD" && e.id)).toBe(true);
		// the ladder: primary extraction → reframed retry → 2 verbatim inserts
		expect(inner.calls).toHaveLength(4);
		expect(inner.calls[0].opts.infer).toBeUndefined(); // primary: extraction lane
		expect(inner.calls[1].opts.metadata?.extractionRetry).toBe(true);
		expect(inner.calls[1].text).toContain("Session outcome"); // the reframed input
		for (const c of inner.calls.slice(2)) {
			expect(c.opts.infer).toBe(false); // verbatim lane, never a third extraction
			expect(c.opts.metadata?.salvage).toBe(true);
			expect(c.opts.metadata?.kind).toBe("note"); // original metadata preserved
			expect(c.opts.agentId).toBe("project:acme"); // scope preserved
		}
		expect(inner.calls[2].text).toBe(salvaged[0]);
		expect(inner.calls[3].text).toBe(salvaged[1]);
		// exactly ONE salvage LLM call, compact system prompt, dream model
		expect(llmCalls).toHaveLength(1);
		expect(llmCalls[0].messages[0].role).toBe("system");
		expect(llmCalls[0].messages[0].content).toContain("Return ONLY a JSON object");
		expect(llmCalls[0].messages[1].content).toContain("Session outcome"); // the reframed note
		expect(llmCalls[0].opts?.model).toBe(modelFor("dream"));
	});

	test("salvage observability: extraction-retry then extraction-salvage emitted, no extraction-miss", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		setSalvageLlmForTests(async () => ({ memories: ["Run tests with bun test from the package root"] }));
		const retry: Array<Record<string, unknown>> = [];
		const salvage: Array<Record<string, unknown>> = [];
		const miss: Array<Record<string, unknown>> = [];
		const onRetry = (p: Record<string, unknown>) => retry.push(p);
		const onSalvage = (p: Record<string, unknown>) => salvage.push(p);
		const onMiss = (p: Record<string, unknown>) => miss.push(p);
		bus.on("mem0:extraction-retry", onRetry);
		bus.on("mem0:extraction-salvage", onSalvage);
		bus.on("mem0:extraction-miss", onMiss);
		try {
			const events = await platform.add(NOTE, SCOPE);
			expect(events).toHaveLength(1);
			expect(retry).toEqual([{ scope: "project:acme" }]);
			expect(salvage).toEqual([{ scope: "project:acme", memories: 1 }]);
			expect(miss).toEqual([]);
		} finally {
			bus.off("mem0:extraction-retry", onRetry);
			bus.off("mem0:extraction-salvage", onSalvage);
			bus.off("mem0:extraction-miss", onMiss);
		}
	});

	test("salvage returns [] → mem0:extraction-miss emitted with scope + noteChars, add returns []", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		setSalvageLlmForTests(async () => ({ memories: [] }));
		const miss: Array<Record<string, unknown>> = [];
		const onMiss = (p: Record<string, unknown>) => miss.push(p);
		bus.on("mem0:extraction-miss", onMiss);
		try {
			const events = await platform.add(NOTE, SCOPE);
			expect(events).toEqual([]);
			expect(miss).toHaveLength(1);
			expect(miss[0].scope).toBe("project:acme");
			expect(miss[0].noteChars).toBe(NOTE.length);
		} finally {
			bus.off("mem0:extraction-miss", onMiss);
		}
	});

	test("an unparseable salvage response is a miss, not a throw (bounded: one call per add)", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		let llmCalls = 0;
		setSalvageLlmForTests(async () => {
			llmCalls++;
			throw new Error("llm: no JSON object found in response");
		});
		const events = await platform.add(NOTE, SCOPE);
		expect(events).toEqual([]);
		expect(llmCalls).toBe(1); // never a loop
	});

	test("a successful primary extraction never touches the salvage lane", async () => {
		const calls: any[] = [];
		const memory = {
			async add(text: any, opts: any = {}) {
				calls.push({ text, opts });
				if (opts?.infer === false) throw new Error("verbatim lane must not run");
				return { results: [{ id: "m1", memory: "extracted rule", metadata: { event: "ADD" } }] };
			},
		};
		const platform = new Mem0Platform(memory as any, "lexical");
		let llmCalls = 0;
		setSalvageLlmForTests(async () => {
			llmCalls++;
			return { memories: ["never"] };
		});
		const events = await platform.add(NOTE, SCOPE);
		expect(events.map((e) => e.text)).toEqual(["extracted rule"]);
		expect(llmCalls).toBe(0);
		expect(calls).toHaveLength(1);
	});

	test("a metadata-only note never reaches the salvage LLM (no spend, no miss event)", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		let llmCalls = 0;
		setSalvageLlmForTests(async () => {
			llmCalls++;
			return { memories: [] };
		});
		const metaOnly = [
			"Terminal session outcome in /srv/demo:",
			"Session metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 0 tool call(s), 1 min.",
		].join("\n");
		const miss: Array<Record<string, unknown>> = [];
		const onMiss = (p: Record<string, unknown>) => miss.push(p);
		bus.on("mem0:extraction-miss", onMiss);
		try {
			const events = await platform.add(metaOnly, SCOPE);
			expect(events).toEqual([]);
			expect(llmCalls).toBe(0); // the deterministic strip already said: nothing there
			expect(inner.calls).toHaveLength(1); // primary only — no retry either
			expect(miss).toEqual([]);
		} finally {
			bus.off("mem0:extraction-miss", onMiss);
		}
	});

	test("a short-but-real note (body under the retry's 80-char floor) salvages with the stripped body", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		const note = [
			"Terminal session outcome in /srv/demo:",
			"Final outcome: Suite is flaky under parallel runners; re-run with --runInBand.",
			"Session metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 2 tool call(s), 1 min.",
		].join("\n");
		let salvageInput = "";
		setSalvageLlmForTests(async (messages) => {
			salvageInput = messages[1].content;
			return { memories: ["Suite is flaky under parallel runners — re-run with --runInBand"] };
		});
		const events = await platform.add(note, SCOPE);
		expect(events).toHaveLength(1);
		expect(events[0].text).toBe("Suite is flaky under parallel runners — re-run with --runInBand");
		// no reframe retry (body < 80 chars) — the salvage ran directly on the
		// scaffolding-stripped body, header and metadata line gone
		expect(salvageInput).toBe("Suite is flaky under parallel runners; re-run with --runInBand.");
		expect(inner.calls.map((c) => c.opts.infer)).toEqual([undefined, false]);
	});

	test("salvage output is bounded: non-strings/empties dropped, 240-char trim, hard cap 8", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		setSalvageLlmForTests(async () => ({
			memories: [
				"",
				"   ",
				{ text: "an object is not a memory string" },
				"x".repeat(300),
				...Array.from({ length: 10 }, (_, i) => `rule ${i}`),
			],
		}));
		const events = await platform.add(NOTE, SCOPE);
		expect(events).toHaveLength(8);
		expect(events[0].text).toBe("x".repeat(240)); // trimmed, not a 300-char bullet
		expect(events.slice(1).map((e) => e.text)).toEqual(["rule 0", "rule 1", "rule 2", "rule 3", "rule 4", "rule 5", "rule 6"]);
	});

	test("the \"memory\" response key (mem0's own spelling) is accepted tolerantly", async () => {
		const inner = makeStochasticInner();
		const platform = new Mem0Platform(inner.memory as any, "lexical");
		setSalvageLlmForTests(async () => ({ memory: ["Recovered via the mem0-shaped key"] }));
		const events = await platform.add(NOTE, SCOPE);
		expect(events.map((e) => e.text)).toEqual(["Recovered via the mem0-shaped key"]);
	});
});

// ----------------------------------------------- BUG 2: revert is verbatim

describe("revertMemoryEvents — DELETE restores verbatim, no extraction (BUG 2)", () => {
	/**
	 * A recording platform whose infer lane TRANSFORMS the input (proves the
	 * revert did not go through extraction) while the infer:false lane is
	 * verbatim per message — mirroring the real SDK's two lanes.
	 */
	function makeRecordingPlatform() {
		const addCalls: Array<{ text: string; metadata?: any; infer?: boolean }> = [];
		const deleteCalls: string[] = [];
		const updateCalls: Array<{ id: string; text: string }> = [];
		let n = 0;
		const platform: MemoryPlatform = {
			backend: "recording-fake",
			async add(text, _scope, metadata = {}, opts = {}) {
				addCalls.push({ text: typeof text === "string" ? text : JSON.stringify(text), metadata, infer: opts.infer });
				const inputs = typeof text === "string" ? [text] : text.map((m) => m.content);
				const events = [];
				for (const input of inputs) {
					if (opts.infer === false) {
						events.push({ event: "ADD" as const, id: `r-${++n}`, text: input });
					} else {
						// the "creative" extraction lane: line-split + rewritten —
						// anything restored through it is NOT the original memory
						for (const piece of input.split("\n").map((s) => s.trim()).filter(Boolean)) {
							events.push({ event: "ADD" as const, id: `r-${++n}`, text: `EXTRACTED: ${piece}` });
						}
					}
				}
				return events;
			},
			async getAll() {
				return [];
			},
			async search() {
				return [];
			},
			async delete(id) {
				deleteCalls.push(id);
			},
			async update(id, text) {
				updateCalls.push({ id, text });
			},
		};
		return { platform, addCalls, deleteCalls, updateCalls };
	}
	const SCOPE = { agentId: "project:acme" };

	test("DELETE re-adds previousText with infer:false and the ORIGINAL kind (not \"revert\")", async () => {
		const { platform, addCalls } = makeRecordingPlatform();
		const { reverted, errors } = await revertMemoryEvents(
			[{ event: "DELETE", id: "m1", text: "old text", previousText: "Run tests with bun test", kind: "seed" }],
			SCOPE,
			{ platform },
		);
		expect(errors).toEqual([]);
		expect(reverted).toBe(1);
		expect(addCalls).toHaveLength(1);
		// the pre-fix bug: no infer opt (full extraction LLM on a rollback) and
		// kind always "revert" (seed/harness cap immunity lost)
		expect(addCalls[0].infer).toBe(false);
		expect(addCalls[0].text).toBe("Run tests with bun test");
		expect(addCalls[0].metadata?.kind).toBe("seed");
	});

	test("DELETE without a recorded kind falls back to kind \"revert\" (still infer:false)", async () => {
		const { platform, addCalls } = makeRecordingPlatform();
		await revertMemoryEvents([{ event: "DELETE", id: "m1", text: "t", previousText: "Deploy with bun run deploy:staging" }], SCOPE, {
			platform,
		});
		expect(addCalls).toHaveLength(1);
		expect(addCalls[0].infer).toBe(false);
		expect(addCalls[0].metadata?.kind).toBe("revert");
		expect(addCalls[0].text).toBe("Deploy with bun run deploy:staging");
	});

	test("a multi-line memory restores VERBATIM — the extraction lane would have split/rewritten it", async () => {
		const { platform, addCalls } = makeRecordingPlatform();
		const original = "Suite is flaky under parallel runners; re-run with --runInBand.\nDeploy with bun run deploy:staging first.";
		await revertMemoryEvents([{ event: "DELETE", id: "m1", text: "t", previousText: original }], SCOPE, { platform });
		expect(addCalls).toHaveLength(1);
		expect(addCalls[0].infer).toBe(false);
		expect(addCalls[0].text).toBe(original); // one verbatim memory, not two EXTRACTED: lines
	});

	test("ADD → delete, UPDATE → restore previousText (the other two lanes unchanged)", async () => {
		const { platform, addCalls, deleteCalls, updateCalls } = makeRecordingPlatform();
		const { reverted } = await revertMemoryEvents(
			[
				{ event: "ADD", id: "a1", text: "added" },
				{ event: "UPDATE", id: "u1", text: "new", previousText: "old" },
			],
			SCOPE,
			{ platform },
		);
		expect(reverted).toBe(2);
		expect(deleteCalls).toEqual(["a1"]);
		expect(updateCalls).toEqual([{ id: "u1", text: "old" }]);
		expect(addCalls).toEqual([]); // a DELETE-less stream never re-adds
	});
});

// ------------------------------------- BUG 4: idempotence-aware comparison

describe("renderFooterMatches — idempotence-aware render comparison (BUG 4)", () => {
	const MEM = [{ id: "m1", text: "Run tests with bun test", updatedAt: "2026-10-29T10:00:00.000Z", createdAt: "2026-10-29T10:00:00.000Z", metadata: { kind: "seed" } }];

	test("same content, different footer ISO → equal (the dream no-change check unblocks)", () => {
		const doc = (iso: string) =>
			`# Project Memory\n\n## Workflow\n\n- Run tests with bun test\n\n<!-- unown: rendered 1/1 memories via Mem0 (backend: lexical) at ${iso} -->\n`;
		expect(renderFooterMatches(doc("2026-10-29T10:00:00.000Z"), doc("2026-10-29T11:59:59.999Z"))).toBe(true);
	});

	test("different content → not equal", () => {
		const a = `# Project Memory\n\n## Workflow\n\n- Run tests with bun test\n\n<!-- unown: rendered 1/1 memories via Mem0 (backend: lexical) at 2026-10-29T10:00:00.000Z -->\n`;
		const b = `# Project Memory\n\n## Workflow\n\n- Run tests with bun test\n- Deploy with bun run deploy:staging\n\n<!-- unown: rendered 1/1 memories via Mem0 (backend: lexical) at 2026-10-29T10:00:00.000Z -->\n`;
		expect(renderFooterMatches(a, b)).toBe(false);
	});

	test("two real renders of the same memory set compare equal regardless of timestamps", () => {
		const first = renderProjectMemoryMarkdown(MEM, { backend: "lexical" });
		const second = renderProjectMemoryMarkdown(MEM, { backend: "lexical" });
		expect(renderFooterMatches(first, second)).toBe(true);
		// and the raw strings may differ only by the footer timestamp: the
		// strip makes them byte-identical
		expect(stripRenderFooterTimestamp(first)).toBe(stripRenderFooterTimestamp(second));
	});

	test("the empty-scope skeleton footer is normalized too", () => {
		const a = renderProjectMemoryMarkdown([], { backend: "lexical" });
		const b = a.replace(/ at \d{4}-\d{2}-\d{2}T[\d:.]+Z -->/, " at 2099-01-01T00:00:00.000Z -->");
		expect(renderFooterMatches(a, b)).toBe(true);
	});

	test("stripRenderFooterTimestamp is footer-anchored: ISO dates in bullets are untouched", () => {
		const doc = [
			"# Project Memory",
			"",
			"## Workflow",
			"",
			"- freeze deploys at 2026-10-29T10:00:00.000Z --> not a footer",
			"",
			"<!-- unown: rendered 1/1 memories via Mem0 (backend: lexical) at 2026-10-29T10:00:00.000Z -->",
			"",
		].join("\n");
		const out = stripRenderFooterTimestamp(doc);
		expect(out).toContain("- freeze deploys at 2026-10-29T10:00:00.000Z --> not a footer");
		expect(out).toContain("via Mem0 (backend: lexical) -->"); // the footer's timestamp gone
	});
});

// -------------------------------------- BUG 5: partial-reindex honesty

describe("applyEmbedderBackendSwitch — partial reindex honesty (BUG 5)", () => {
	afterEach(() => {
		store.run(`DELETE FROM memory_platform WHERE key = 'embedder_backend'`);
	});

	const recordedBackend = () =>
		store.get<{ value: string }>(`SELECT value FROM memory_platform WHERE key = 'embedder_backend'`)?.value ?? null;
	const recordBackend = (value: string) =>
		store.run(
			`INSERT INTO memory_platform (key, value, updated_at) VALUES ('embedder_backend', ?, 0)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			[value],
		);

	/** A fake mem0 Memory exposing just the reindex surface: vectorStore
	 *  list/update over `rows` and an embedder that can be told to fail on a
	 *  specific embed call (row N of the pass). */
	function fakeMemory(rows: Array<{ id: string; text: string }>, failOnEmbed?: number) {
		let embeds = 0;
		const updated: string[] = [];
		return {
			updated,
			embedder: {
				async embed(_text: string) {
					embeds++;
					if (failOnEmbed !== undefined && embeds === failOnEmbed) throw new Error("simulated embedder crash mid-reindex");
					return new Array(384).fill(0.01);
				},
			},
			vectorStore: {
				async list(_filters: unknown, _limit: number) {
					return [rows.map((r) => ({ id: r.id, payload: { data: r.text } })), rows.length];
				},
				async update(id: string, _vec: number[], _payload: unknown) {
					updated.push(id);
				},
			},
		};
	}

	const ROWS = [
		{ id: "m1", text: "Run tests with bun test" },
		{ id: "m2", text: "Deploy with bun run deploy:staging" },
		{ id: "m3", text: "Suite is flaky under parallel runners" },
	];

	test("embedder fails on row 2 of 3 → partial: old backend kept, mem0:reindex-partial emitted", async () => {
		recordBackend("lexical"); // the machine's recorded state from its lexical boots
		const mem = fakeMemory(ROWS, 2);
		const partial: Array<Record<string, unknown>> = [];
		const reindexed: Array<Record<string, unknown>> = [];
		const onPartial = (p: Record<string, unknown>) => partial.push(p);
		const onReindexed = (p: Record<string, unknown>) => reindexed.push(p);
		bus.on("mem0:reindex-partial", onPartial);
		bus.on("mem0:reindexed", onReindexed);
		try {
			const outcome = await applyEmbedderBackendSwitch(mem as any, "lexical", "onnx");
			expect(outcome).toEqual({ ok: false, done: 1, total: 3 });
			// the marker stays OLD — the next boot re-attempts the switch
			expect(recordedBackend()).toBe("lexical");
			expect(partial).toEqual([{ done: 1, total: 3 }]);
			expect(reindexed).toEqual([]); // never reported as a completed reindex
			expect(mem.updated).toEqual(["m1"]); // only the row before the crash
		} finally {
			bus.off("mem0:reindex-partial", onPartial);
			bus.off("mem0:reindexed", onReindexed);
		}
	});

	test("retry next boot (healthy embedder) → full pass, backend flips, mem0:reindexed emitted", async () => {
		recordBackend("lexical"); // the partial boot left it old
		const mem = fakeMemory(ROWS);
		const reindexed: Array<Record<string, unknown>> = [];
		const onReindexed = (p: Record<string, unknown>) => reindexed.push(p);
		bus.on("mem0:reindexed", onReindexed);
		try {
			const outcome = await applyEmbedderBackendSwitch(mem as any, "lexical", "onnx");
			expect(outcome).toEqual({ ok: true, done: 3, total: 3 });
			expect(recordedBackend()).toBe("onnx");
			expect(reindexed).toEqual([{ from: "lexical", to: "onnx", memories: 3 }]);
			expect(mem.updated).toEqual(["m1", "m2", "m3"]);
		} finally {
			bus.off("mem0:reindexed", onReindexed);
		}
	});

	test("full success records the new backend (the normal switch path)", async () => {
		recordBackend("lexical");
		const mem = fakeMemory(ROWS);
		const outcome = await applyEmbedderBackendSwitch(mem as any, "lexical", "onnx");
		expect(outcome.ok).toBe(true);
		expect(recordedBackend()).toBe("onnx");
	});

	test("vector-store surface missing → ok:false, old backend kept, partial {0,0} emitted", async () => {
		recordBackend("lexical");
		const partial: Array<Record<string, unknown>> = [];
		const onPartial = (p: Record<string, unknown>) => partial.push(p);
		bus.on("mem0:reindex-partial", onPartial);
		try {
			const outcome = await applyEmbedderBackendSwitch({ vectorStore: {} } as any, "lexical", "onnx");
			expect(outcome).toEqual({ ok: false, done: 0, total: 0 });
			expect(recordedBackend()).toBe("lexical");
			expect(partial).toEqual([{ done: 0, total: 0 }]);
		} finally {
			bus.off("mem0:reindex-partial", onPartial);
		}
	});

	test("an empty store is a full success (0/0) — the backend still records", async () => {
		recordBackend("lexical");
		const mem = fakeMemory([]);
		const outcome = await applyEmbedderBackendSwitch(mem as any, "lexical", "onnx");
		expect(outcome).toEqual({ ok: true, done: 0, total: 0 });
		expect(recordedBackend()).toBe("onnx");
	});
});

// ------------------------------- BUG 11: manual-notes stay out of the import

describe("importLegacyMarkdown — manual-notes exclusion (BUG 11)", () => {
	const SCOPE = { agentId: "project:acme" };
	// A pre-swap project.md: topic sections, a Manual notes section (the
	// user's hand-edit lane) and the render footer.
	const LEGACY = [
		"# Project Memory",
		"",
		"## Workflow",
		"- Run tests with bun test from the package root",
		"- Deploy with bun run deploy:staging first",
		"",
		"## Known pitfalls",
		"- Suite is flaky under parallel runners; re-run with --runInBand",
		"",
		"## Manual notes",
		"- my hand-written note that must never import as a platform memory",
		"- another manual bullet with a local convention",
		"",
		"<!-- unown: rendered 3/3 memories via Mem0 (backend: lexical) at 2026-10-29T10:00:00.000Z -->",
	].join("\n");

	test("topic bullets import; manual-notes bullets never do", async () => {
		const platform = makeFakePlatform();
		const n = await importLegacyMarkdown(LEGACY, SCOPE, { platform });
		expect(n).toBe(3); // the three topic bullets
		const texts = [...platform.store.values()].map((m) => m.text);
		expect(texts).toContain("Run tests with bun test from the package root");
		expect(texts).toContain("Deploy with bun run deploy:staging first");
		expect(texts).toContain("Suite is flaky under parallel runners; re-run with --runInBand");
		expect(texts.some((t) => t.includes("hand-written"))).toBe(false);
		expect(texts.some((t) => t.includes("another manual bullet"))).toBe(false);
	});

	test("the render still carries the manual section VERBATIM — exactly once, no duplication loop", async () => {
		const platform = makeFakePlatform();
		await importLegacyMarkdown(LEGACY, SCOPE, { platform });
		const rendered = renderProjectMemoryMarkdown(await platform.getAll(SCOPE), {
			preserveManualNotesFrom: LEGACY,
			backend: "lexical",
		});
		expect(rendered).toContain("- my hand-written note that must never import as a platform memory");
		// the duplication fingerprint: pre-fix, the manual bullet ALSO lived as
		// a platform memory, so it rendered twice (platform bullet + preserved
		// section) on every dream, forever
		expect(rendered.match(/hand-written note/g)?.length ?? 0).toBe(1);
		expect(rendered.match(/another manual bullet/g)?.length ?? 0).toBe(1);
	});

	test("a manual-notes section at EOF (no footer after it) is excluded too", async () => {
		const legacy = [
			"# Project Memory",
			"",
			"## Workflow",
			"- Run tests with bun test from the package root",
			"",
			"## Manual notes",
			"- trailing manual note at end of file",
		].join("\n");
		const platform = makeFakePlatform();
		const n = await importLegacyMarkdown(legacy, SCOPE, { platform });
		expect(n).toBe(1);
		expect([...platform.store.values()].some((m) => m.text.includes("trailing manual note"))).toBe(false);
	});

	test("a file without a manual section imports unchanged (no regression)", async () => {
		const legacy = "# Project Memory\n\n## Workflow\n- Run tests with bun test from the package root\n";
		const platform = makeFakePlatform();
		const n = await importLegacyMarkdown(legacy, SCOPE, { platform });
		expect(n).toBe(1);
	});
});
