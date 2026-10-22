/**
 * memzero-unit.test.ts — pure-function pins for the Mem0 seam: the note
 * reframe used by the empty-extraction escalation, the add() result mapping,
 * and the payload-shape normalization (the metadata nesting regression).
 *
 * No platform construction, no SQLite, no LLM — these are the deterministic
 * invariants of the 2026-10-22 benchtest fixes.
 */
import { describe, expect, test } from "bun:test";
import { MEM0_CUSTOM_INSTRUCTIONS, normalizeMemories, reframeNoteForExtraction } from "../src/memzero.ts";

// ---------------------------------------------------------------- reframe

describe("reframeNoteForExtraction", () => {
	const NEW_NOTE = [
		"Terminal session outcome in /home/z/scratch/acme-api:",
		'Final outcome: Fixed dedupeRows in src/dedupe.ts — the function only did exact-match dedup, so CRLF line endings left \\r in the comparison key and output. Normalized each line with line.replace(/\\r$/, "") before comparing. bun test passes 2/2.',
		"Session metadata (never extractable — counts and duration only): 1 prompt(s), 5 tool call(s) (read, edit, bash), 1 min.",
	].join("\n");

	const OLD_NOTE = [
		"Terminal session in /home/z/scratch/acme-api (1 min): 1 prompt(s), 5 tool call(s) (read, edit, bash).",
		"Final outcome: Fixed dedupeRows in src/dedupe.ts — CRLF line endings left \\r in the comparison key; normalized before comparing; bun test passes 2/2.",
		"If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.",
	].join("\n");

	test("new-format note: header, metadata and Final-outcome prefix are stripped, body survives", () => {
		const out = reframeNoteForExtraction(NEW_NOTE)!;
		expect(out).not.toContain("Terminal session");
		expect(out).not.toContain("Session metadata");
		expect(out).not.toContain("Final outcome:");
		expect(out).toContain("CRLF line endings");
		expect(out).toContain("bun test passes");
		expect(out.startsWith("Session outcome — extract the durable engineering knowledge")).toBe(true);
	});

	test("old-format note: metadata header and guidance line are stripped too", () => {
		const out = reframeNoteForExtraction(OLD_NOTE)!;
		expect(out).not.toContain("Terminal session in");
		expect(out).not.toContain("If the session hit failures");
		expect(out).toContain("CRLF line endings");
	});

	test("message-array input is joined role-first, same stripping applies", () => {
		const out = reframeNoteForExtraction([{ role: "user", content: NEW_NOTE }])!;
		expect(out).not.toContain("Session metadata");
		expect(out).toContain("CRLF");
	});

	test("[subagent] tagged headers are stripped (both formats)", () => {
		const subNew = NEW_NOTE.replace("Terminal session outcome in", "Terminal session [subagent] outcome in");
		const subOld = OLD_NOTE.replace("Terminal session in", "Terminal session [subagent] in");
		expect(reframeNoteForExtraction(subNew)).not.toContain("Terminal session");
		expect(reframeNoteForExtraction(subOld)).not.toContain("Terminal session");
	});

	test("shield telemetry line is stripped", () => {
		const withShield = NEW_NOTE.replace(
			"Final outcome:",
			"Injection shield flagged 2 tool output(s) this session (flags: secrecy, override) — treat with suspicion.\nFinal outcome:",
		);
		const out = reframeNoteForExtraction(withShield)!;
		expect(out).not.toContain("Injection shield");
	});

	test("metadata-only note returns null (no retry spend)", () => {
		const metaOnly = [
			"Terminal session outcome in /srv/demo:",
			"Session metadata (never extractable — counts and duration only): 1 prompt(s), 0 tool call(s), 1 min.",
		].join("\n");
		expect(reframeNoteForExtraction(metaOnly)).toBeNull();
	});

	test("short-body note below the 80-char substantive floor returns null", () => {
		expect(reframeNoteForExtraction("hi")).toBeNull();
		expect(reframeNoteForExtraction("x".repeat(79))).toBeNull();
		expect(reframeNoteForExtraction("x".repeat(80)).startsWith("Session outcome")).toBe(true);
	});
});

// ---------------------------------------------------------------- normalize

describe("normalizeMemories (payload shapes)", () => {
	test("real-platform shape: metadata nests at payload.metadata (2026-10-22 regression)", () => {
		const rows = [
			{
				id: "m1",
				payload: {
					data: "Run tests with bun test",
					metadata: { kind: "seed", agent_id: "project:acme" },
					createdAt: 1,
					updatedAt: 2,
				},
				score: 0.9,
			},
		];
		const [m] = normalizeMemories(rows);
		expect(m.id).toBe("m1");
		expect(m.text).toBe("Run tests with bun test");
		expect(m.metadata.kind).toBe("seed"); // the regression: was the whole payload
		expect(m.metadata.agent_id).toBe("project:acme");
		expect(m.score).toBe(0.9);
	});

	test("flat/fake shape: whole-payload fallback keeps metadata readable", () => {
		const rows = [{ id: "m2", data: "plain row", kind: "harness" }];
		const [m] = normalizeMemories(rows);
		expect(m.text).toBe("plain row");
		expect(m.metadata.kind).toBe("harness");
	});

	test("empty-text rows are dropped (the observed empty-memory store bug)", () => {
		const rows = [
			{ id: "ok", payload: { data: "real", metadata: {} } },
			{ id: "blank", payload: { data: "", metadata: {} } },
			{ id: "space", payload: { data: "   ", metadata: {} } },
			{ id: "", payload: { data: "no id" } },
		];
		expect(normalizeMemories(rows)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------- instructions

describe("MEM0_CUSTOM_INSTRUCTIONS", () => {
	test("carries the terminal-note carve-out (pitfalls/fixes are knowledge)", () => {
		expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("Terminal-session notes");
		expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("ONLY the counts/duration metadata itself is never extractable");
	});
});
