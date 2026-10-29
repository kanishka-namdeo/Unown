/**
 * recovery.test.ts — the observability round's recovery surface: the tool-result
 * classifier (producer markers), the worst-first rows with fix paths, the
 * /recovery card and the ambient health chip.
 */
import { describe, expect, test } from "bun:test";
import {
	classifyToolResult,
	deriveRecoveryRows,
	renderHealthChip,
	renderRecoveryCard,
	type RecoveryEvent,
} from "../src/recovery.ts";

const NOW = 1_700_000_000_000;

describe("classifyToolResult — the producers' own markers decide the kind", () => {
	test("green results are never events (a quiet session stays quiet)", () => {
		expect(classifyToolResult("bash", false, "whatever", NOW)).toBeNull();
	});
	test("verify/test gate failures are recognized by their [auto-*] marker", () => {
		const e = classifyToolResult("edit", true, "\n\n[auto-verify] `tsc --noEmit` failed (exit 2)", NOW);
		expect(e?.kind).toBe("verify-failure");
		expect(e?.tool).toBe("edit");
	});
	test("permission denials beat plain errors", () => {
		const e = classifyToolResult("bash", true, "[unown-permissions] denied by rule \"rm *\" (bash)", NOW);
		expect(e?.kind).toBe("denial");
	});
	test("any other isError is a plain tool error, clipped to one line", () => {
		const e = classifyToolResult("bash", true, "npm test failed\n\n".repeat(50), NOW);
		expect(e?.kind).toBe("tool-error");
		expect((e?.reason ?? "").length).toBeLessThanOrEqual(160);
	});
});

describe("deriveRecoveryRows — worst-first, engine before events, fix per row", () => {
	test("engine state outranks any single tool error", () => {
		const events: RecoveryEvent[] = [
			{ kind: "tool-error", tool: "bash", reason: "exit 1", ts: NOW - 1000 },
		];
		const rows = deriveRecoveryRows({ events, engine: { state: "down", queued: 2 }, now: NOW });
		expect(rows[0].label).toBe("engine");
		expect(rows[0].detail).toContain("2 notes queued");
		expect(rows.some((r) => r.label === "tool error")).toBe(true);
	});
	test("events sort newest-first within their kind rank, capped at six", () => {
		const events: RecoveryEvent[] = Array.from({ length: 8 }, (_, i) => ({
			kind: "tool-error" as const,
			tool: "bash",
			reason: `err ${i}`,
			ts: NOW - (8 - i) * 1000,
		}));
		const rows = deriveRecoveryRows({ events, now: NOW });
		expect(rows.length).toBe(6);
		expect(rows[0].detail).toContain("err 7");
	});
	test("dead letters carry their hand-recoverable fix", () => {
		const rows = deriveRecoveryRows({ events: [], engine: { dead: 1 } });
		expect(rows[0].fix).toContain("notes/dead");
	});
});

describe("renderRecoveryCard + renderHealthChip", () => {
	test("a clean session gets the clean bill plus the standing line", () => {
		const card = renderRecoveryCard({
			rows: [],
			totals: { toolErrors: 0, verifyFailures: 0, denials: 0 },
		});
		expect(card).toContain("nothing needs attention");
		expect(card).toContain("standing: /undo n");
		expect(renderHealthChip([])).toBeUndefined();
	});
	test("attention items count into the chip with the drill-in command", () => {
		const rows = deriveRecoveryRows({
			events: [{ kind: "verify-failure", tool: "edit", reason: "tsc failed", ts: NOW - 60_000 }],
			now: NOW,
		});
		expect(renderHealthChip(rows)).toBe("✗ 1 to fix · /recovery");
		const card = renderRecoveryCard({
			rows,
			totals: { toolErrors: 0, verifyFailures: 1, denials: 0 },
		});
		expect(card).toContain("verify failed: edit — tsc failed");
		expect(card).toContain("fix: /undo n reverts the last n edit turns");
		expect(card).toContain("counts: 0 errors · 1 verify fail · 0 blocked");
	});
});
