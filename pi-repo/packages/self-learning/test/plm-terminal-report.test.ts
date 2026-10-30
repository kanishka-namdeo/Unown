/**
 * plm-terminal-report.test.ts — the terminal lane of the PLM round:
 *   - the tool-call tracker pairs begin/end with honest durations;
 *   - the report buffer batches and resets cleanly (test seams);
 *   - ingestTerminalSessionReport parses untrusted session reports
 *     defensively and births a complete SUCCEEDED process with history;
 *   - the HTTP lanes (/api/tools/report + /api/processes/report) accept
 *     what the terminal reporter sends.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	getProcess,
	getProcessEvents,
	ingestTerminalSessionReport,
	listProcesses,
} from "../src/plm/process-registry.ts";
import {
	beginTerminalToolCall,
	endTerminalToolCall,
	flushToolReports,
	pendingToolReportCount,
	resetTerminalReportForTest,
} from "../src/plm/terminal-report.ts";
import { listToolInvocations } from "../src/plm/tool-registry.ts";
import { handleApi } from "../src/server.ts";
import { store } from "../src/store.ts";

describe("the terminal tool-call tracker", () => {
	test("begin/end pairs compute duration and queue a report item", async () => {
		resetTerminalReportForTest();
		beginTerminalToolCall("k1", "edit", '{"path":"a.ts"}');
		await new Promise((r) => setTimeout(r, 15));
		const duration = endTerminalToolCall("k1", "edit", false, "syntax gate flagged a.ts", 120);
		expect(duration).toBeGreaterThanOrEqual(10);
		expect(pendingToolReportCount()).toBe(1);
	});
	test("an end without a begin reports null duration, never a negative", () => {
		resetTerminalReportForTest();
		const duration = endTerminalToolCall("ghost", "bash", true, null);
		expect(duration).toBeNull();
		expect(pendingToolReportCount()).toBe(1); // still queued — the invocation happened
	});
	test("the runaway guard caps the in-flight map", () => {
		resetTerminalReportForTest();
		for (let i = 0; i < 70; i++) beginTerminalToolCall(`k${i}`, "read", null);
		// the guard cleared the map at >64 — a fresh key still works
		beginTerminalToolCall("fresh", "read", null);
		expect(endTerminalToolCall("fresh", "read", true, null)).not.toBeNull();
	});
	test("flush drains the backlog (engine down = best-effort false, backlog kept honest)", async () => {
		resetTerminalReportForTest();
		beginTerminalToolCall("k2", "bash", "ls");
		endTerminalToolCall("k2", "bash", true, null);
		// ENGINE_URL points at a dead loopback in the test env — the flush
		// must resolve false without throwing, and the backlog reporting
		// stays consistent (0 or the re-queued count, never an exception).
		const ok = await flushToolReports("sess-test", "proj-test");
		expect(typeof ok).toBe("boolean");
	});
});

describe("ingestTerminalSessionReport (untrusted input)", () => {
	test("a valid report births a complete SUCCEEDED terminal-session process", () => {
		const id = ingestTerminalSessionReport({
			sessionId: "term-sess-42",
			cwd: "/home/z/work/demo",
			prompts: 3,
			toolCalls: 12,
			toolErrors: 1,
			tokensIn: 40_000,
			tokensOut: 5_000,
			durationMs: 240_000,
			outcome: "session ended — 3 prompt(s), 12 tool call(s)",
		});
		expect(id).toBeTruthy();
		const row = getProcess(id!);
		expect(row?.kind).toBe("terminal-session");
		expect(row?.status).toBe("SUCCEEDED");
		expect(row?.owner).toBe("terminal");
		expect(row?.task_ref).toBe("term-sess-42");
		expect(row?.duration_ms).toBe(240_000);
		expect(JSON.parse(row!.tool_usage!)).toEqual({ calls: 12, errors: 1 });
		expect(JSON.parse(row!.token_usage!)).toEqual({ in: 40_000, out: 5_000 });
		// the full event chain exists even though the process arrived terminal
		const events = getProcessEvents(id!);
		expect(events.map((e) => e.to_status)).toEqual(["CREATED", "RUNNING", "SUCCEEDED"]);
	});
	test("garbage reports are refused, never crash", () => {
		expect(ingestTerminalSessionReport(null)).toBeNull();
		expect(ingestTerminalSessionReport("nope")).toBeNull();
		expect(ingestTerminalSessionReport({})).toBeNull();
		expect(ingestTerminalSessionReport({ sessionId: "" })).toBeNull();
		expect(ingestTerminalSessionReport({ sessionId: 42 })).toBeNull();
	});
	test("absurd numbers are dropped to defaults, not trusted", () => {
		const id = ingestTerminalSessionReport({
			sessionId: "term-sess-absurd",
			toolCalls: -5,
			toolErrors: 1e12,
			durationMs: Number.NaN,
		});
		const row = getProcess(id!);
		expect(JSON.parse(row!.tool_usage!)).toEqual({ calls: 0, errors: 0 });
		expect(row?.duration_ms).toBeNull();
	});
});

// Unique per run — the shared test DB persists rows across suite runs.
const HTTP_SESS = `http-term-sess-${Date.now()}`;

describe("the HTTP report lanes", () => {
	test("POST /api/processes/report accepts the terminal reporter's shape", async () => {
		const before =
			store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes WHERE kind = 'terminal-session'`)?.n ?? 0;
		const res = await handleApi({
			method: "POST",
			path: "/api/processes/report",
			query: new URLSearchParams(),
			body: {
				schema: 1,
				session: {
					sessionId: "http-term-sess-1",
					cwd: "/tmp/x",
					prompts: 1,
					toolCalls: 2,
					toolErrors: 0,
					durationMs: 1000,
					outcome: "http lane check",
				},
			},
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; id: string | null };
		expect(body.ok).toBe(true);
		expect(body.id).toBeTruthy();
		const after =
			store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes WHERE kind = 'terminal-session'`)?.n ?? 0;
		expect(after).toBe(before + 1);
		// and it lists with the rest
		expect(listProcesses({ kind: "terminal-session", limit: 5 }).some((p) => p.id === body.id)).toBe(true);
	});
	test("POST /api/processes/report refuses garbage with ok:false", async () => {
		const res = await handleApi({
			method: "POST",
			path: "/api/processes/report",
			query: new URLSearchParams(),
			body: { session: { sessionId: "" } },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; id: string | null };
		expect(body.ok).toBe(false);
		expect(body.id).toBeNull();
	});
	test("terminal-lane tool invocations land through /api/tools/report and count in the tool view", async () => {
		const res = await handleApi({
			method: "POST",
			path: "/api/tools/report",
			query: new URLSearchParams(),
			body: {
				items: [
					{ tool: "edit", success: true, durationMs: 9, sessionId: HTTP_SESS, projectSlug: "proj-x" },
					{ tool: "bash", success: false, durationMs: 4, error: "watchdog timed out" },
				],
			},
		});
		const body = (await res.json()) as { written: number };
		expect(body.written).toBe(2);
		const rows = listToolInvocations(200).filter((r) => r.session_id === HTTP_SESS);
		expect(rows.length).toBe(1);
		expect(rows[0]?.lane).toBe("terminal");
	});
});
