// browser-subagent.test.ts — end-to-end golden tests for the `browser`
// built-in subagent (the interactive-web specialist round).
//
// Spawn-level like task-structured.test.ts: the REAL bin/unown, a private
// UNOWN_HOME, a local fixture site, a REAL Chromium (env-gated), and a
// purpose-built multi-turn mock bridge (helpers.ts's mock scripts exactly
// ONE tool call per run; a browser work loop needs turn-after-turn scripted
// calls, so this file rolls its own queue-driven mock — the parent lane and
// the child lane are distinguished by their toolsets).
//
// Scenarios:
//   1. THE FLAGSHIP LOOP — the parent delegates a form task to the browser
//      subagent; the child starts a real browser, navigates, fill_form's,
//      clicks submit, and its final report quotes the LIVE page's
//      confirmation text (proof the real Chromium ran the real flow: the
//      mock cannot know "submitted Ada/b" any other way — it reads it out
//      of the tool-result message the browser tool produced).
//   2. THE ALLOWLIST — the child's model requests carry exactly the
//      browser agent's toolset (browser + read/grep/find/ls); the child
//      never sees the task tool (no nesting).
//   3. BROWSER MISSING — UNOWN_BROWSER_PATH pointed at nothing: the child's
//      first browser call fails with the actionable per-OS remediation; the
//      scripted child reports "Outcome: failed" quoting it verbatim
//      (the terminal-failure contract).
//   4. BLOCKLIST — UNOWN_BROWSER_BLOCK denies the fixture host; the denial
//      text reaches the child's report verbatim (policy, not hint).
//   5. THE TIMEOUT FIELD — the browser agent's 600_000ms budget resolves
//      through the real routing helper (unit-pinned elsewhere; here the
//      SPAWNED child actually runs under it — asserted via the args the
//      parent builds, imported from the pure module).
//
// Skipped (with the reason printed) when UNOWN_BROWSER_LIVE != 1 or no
// Chromium is discoverable — same convention as browser-live.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { discoverBrowser } from "../../src/browser/config.ts";
import { ROLE_BUILTIN_AGENTS } from "../../src/subagent-builtins.ts";
import { humanizeToolLabel } from "../../src/subagent-progress.ts";
import { buildSubagentArgs, resolveSubagentTimeoutMs } from "../../src/subagent-routing.ts";
import { type MockBridge, parseJsonl, startMockBridge, unown } from "./helpers.ts";

const LIVE = process.env.UNOWN_BROWSER_LIVE === "1";
let browserAvailable = false;
let skipReason = "";
if (LIVE) {
	try {
		const d = discoverBrowser();
		browserAvailable = true;
		process.stderr.write(`[browser-subagent] using ${d.path} (${d.source})\n`);
	} catch (err: any) {
		skipReason = String(err?.message ?? err);
	}
}
const RUN = LIVE && browserAvailable;
const LONG = { timeout: 240_000 } as const;

// ---------------------------------------------------------------------------
// Multi-turn mock bridge: queue-driven, parent/child lanes
// ---------------------------------------------------------------------------

/** One scripted model turn: either a tool call or a final text reply. */
interface Turn {
	toolCall?: { name: string; args: Record<string, unknown> };
	text?: string;
}

interface Lane {
	turns: Turn[];
}

interface MultiTurnBridge extends MockBridge {
	/** All child-lane requests (tools include "browser", not "task"). */
	childRequests: Array<{ tools: string[]; userTexts: string[] }>;
	/** All parent-lane requests (tools include "task"). */
	parentRequests: Array<{ tools: string[]; userTexts: string[] }>;
}

function startMultiTurnBridge(parent: Turn[], child: Turn[]): MultiTurnBridge {
	const bridge = startMockBridge();
	const parentLane: Lane = { turns: [...parent] };
	const childLane: Lane = { turns: [...child] };
	const childRequests: MultiTurnBridge["childRequests"] = [];
	const parentRequests: MultiTurnBridge["parentRequests"] = [];
	// The base mock answers /health + /v1/models; chat requests are served by
	// the queue lanes below. We can't easily intercept Bun.serve's handler, so
	// the lanes work via request OBSERVATION: every recorded request is
	// classified and the NEXT response is prepared from the matching lane.
	// Because the base mock is single-shot, this bridge wraps it: chat
	// requests hitting the base mock get scripted by mutating its recorded
	// userTexts before the response is built — not possible. Instead: run our
	// OWN server and reuse only the conventions.
	bridge.close();
	let seq = 0;
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
				return Response.json({
					ok: true,
					port: server.port,
					requests: seq,
					errors: 0,
					upstream: { ok: true, status: 200 },
					upstreamKeyIsSet: true,
					authRequired: false,
					upstreamUrl: `${url.origin}/v1`,
					defaultModel: "kimi-k2.5",
					models: ["kimi-k2.5", "mock-kimi"],
				});
			}
			if (req.method === "GET" && url.pathname === "/v1/models") {
				return Response.json({
					object: "list",
					data: [
						{ id: "kimi-k2.5", object: "model", owned_by: "llm-bridge" },
						{ id: "mock-kimi", object: "model", owned_by: "llm-bridge" },
					],
				});
			}
			if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
				const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
				const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
				const tools = (Array.isArray(body.tools) ? body.tools : []).map(
					(t: Record<string, any>) => t?.function?.name ?? t?.name ?? t?.type,
				);
				const userTexts = messages
					.filter((m) => m?.role === "user")
					.map((m) => {
						const raw = m?.content;
						return typeof raw === "string"
							? raw
							: Array.isArray(raw)
								? raw
										.filter((p) => (p as Record<string, unknown>)?.type === "text")
										.map((p) => String((p as Record<string, unknown>).text ?? ""))
										.join(" ")
								: "";
					});
				// Lane classification: the parent session carries the task tool;
				// the child never does (UNOWN_SUBAGENT=1 disables nesting).
				const isParent = tools.includes("task");
				const lane = isParent ? parentLane : childLane;
				(isParent ? parentRequests : childRequests).push({ tools, userTexts });
				// The last TOOL-RESULT message text — the browser tool's live
				// output rides here; a scripted final reply may quote it.
				const lastToolResult = [...messages].reverse().find((m) => m?.role === "toolResult" || m?.role === "tool");
				let toolResultText = "";
				if (lastToolResult) {
					const c = lastToolResult.content;
					toolResultText =
						typeof c === "string"
							? c
							: Array.isArray(c)
								? c
										.filter((p) => (p as Record<string, unknown>)?.type === "text")
										.map((p) => String((p as Record<string, unknown>).text ?? ""))
										.join("\n")
								: "";
				}
				// Pop the next scripted turn; an exhausted lane terminates with a
				// plain reply so runs can never hang forever.
				const turn = lane.turns.length > 0 ? lane.turns.shift()! : { text: "Mock reply: done" };
				const text = (turn.text ?? "").replace(/\$\{LIVE_PAGE_TEXT\}/g, toolResultText.slice(0, 2000));
				const model = String(body.model ?? "kimi-k2.5");
				const id = `chatcmpl-mock-${++seq}`;
				const frame = (choices: unknown[], usage?: unknown) =>
					new TextEncoder().encode(
						`data: ${JSON.stringify({
							id,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model,
							choices,
							...(usage ? { usage } : {}),
						})}\n\n`,
					);
				const stream = new ReadableStream({
					start(c) {
						c.enqueue(frame([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]));
						if (turn.toolCall) {
							c.enqueue(
								frame([
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index: 0,
													id: `call-${seq}`,
													type: "function",
													function: {
														name: turn.toolCall.name,
														arguments: JSON.stringify(turn.toolCall.args),
													},
												},
											],
										},
										finish_reason: null,
									},
								]),
							);
							c.enqueue(
								frame([{ index: 0, delta: {}, finish_reason: "tool_calls" }], {
									prompt_tokens: 11,
									completion_tokens: 7,
									total_tokens: 18,
								}),
							);
						} else {
							c.enqueue(frame([{ index: 0, delta: { content: text }, finish_reason: null }]));
							c.enqueue(
								frame([{ index: 0, delta: {}, finish_reason: "stop" }], {
									prompt_tokens: 11,
									completion_tokens: 7,
									total_tokens: 18,
								}),
							);
						}
						c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
						c.close();
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
				});
			}
			return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
		},
	});
	return {
		port: server.port,
		url: `http://127.0.0.1:${server.port}`,
		requests: bridge.requests,
		close: () => server.stop(true),
		childRequests,
		parentRequests,
	};
}

// ---------------------------------------------------------------------------
// Fixture site — a form whose submission writes a confirmation into the DOM
// (same shape as browser-live.test.ts's form, trimmed to this scenario).
// ---------------------------------------------------------------------------

let fixture: { url: string; hits: { path: string; ts: number }[]; close(): void };

beforeAll(() => {
	if (!RUN) return;
	const hits: { path: string; ts: number }[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			hits.push({ path: url.pathname, ts: Date.now() });
			if (url.pathname === "/") {
				return new Response(
					`<!doctype html><html><head><title>Subagent Fixture</title></head><body>
  <h1>Form page</h1>
  <form id="f" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'submitted ' + document.getElementById('nm').value + '/' + document.getElementById('sel').value;">
    <input id="nm" type="text" placeholder="name">
    <select id="sel"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <button type="submit" id="go">Submit form</button>
  </form>
  <div id="out"></div>
</body></html>`,
					{ headers: { "Content-Type": "text/html" } },
				);
			}
			return new Response("not found", { status: 404 });
		},
	});
	fixture = { url: `http://127.0.0.1:${server.port}`, hits, close: () => server.stop(true) };
});

afterAll(() => {
	fixture?.close();
});

// ---------------------------------------------------------------------------
// Scenario 1 + 2: the flagship delegation loop
// ---------------------------------------------------------------------------

describe("browser subagent (end-to-end, real CLI + real Chromium)", () => {
	test.skipIf(!RUN)(
		"parent delegates → child drives the real browser → report quotes the live page",
		async () => {
			const bridge = startMultiTurnBridge(
				// Parent lane: one delegation to the browser subagent.
				[
					{
						toolCall: {
							name: "task",
							args: {
								agent: "browser",
								task: `Open ${fixture!.url}, type "Ada" into the name field, select "Beta", click Submit form, and report the confirmation text exactly.`,
							},
						},
					},
				// Then ECHO the task tool result as the final assistant text (the mock
				// reads the live tool-result message, which is the child's report).
				{ text: "Report: ${LIVE_PAGE_TEXT}" },
				],
				// Child lane: the scripted work loop (start → navigate → fill → click → report).
				[
					{ toolCall: { name: "browser", args: { action: "start" } } },
					{ toolCall: { name: "browser", args: { action: "navigate", url: fixture!.url } } },
					{
						toolCall: {
							name: "browser",
							args: {
								action: "fill_form",
								fields: [
									{ selector: "#nm", value: "Ada" },
									{ selector: "#sel", value: "b" },
								],
							},
						},
					},
					{ toolCall: { name: "browser", args: { action: "click", selector: "#go" } } },
					{
						text: `Outcome: done
Did:
- filled the form and submitted — the page now shows: ${"${LIVE_PAGE_TEXT}"}
Pages:
- ${fixture!.url} — form fixture
Notes:
- none`,
					},
				],
			);
			try {
				const run = await unown(["--mode", "json", "-p", "Delegate the form task."], {
					bridge,
					env: { UNOWN_NO_PREFLIGHT: "1" },
					timeoutMs: 200_000,
				});
				expect(run.exitCode).toBe(0);

				// --- Scenario 2: the child's toolset is exactly the browser agent's
				// allowlist; the child never carries the task tool.
				expect(bridge.childRequests.length).toBeGreaterThanOrEqual(5);
				for (const req of bridge.childRequests) {
					expect(req.tools).toContain("browser");
					expect(req.tools).toContain("read");
					expect(req.tools).not.toContain("task");
					expect(req.tools).not.toContain("edit");
					expect(req.tools).not.toContain("write");
					expect(req.tools).not.toContain("bash");
				}

				// --- The real Chromium really hit the fixture (navigate + snapshot walks).
				expect(fixture!.hits.some((h) => h.path === "/")).toBe(true);

				// --- The parent's final stream carries the child's report, and the
				// report quotes the LIVE confirmation text — which only the real
				// browser could observe (the mock had no other source for it).
				const events = parseJsonl(run.stdout);
				const finalTexts = events
					.filter((e) => e?.type === "message_end" && e?.message?.role === "assistant")
					.map((e) => String(e?.message?.content?.[0]?.text ?? ""));
				const allText = finalTexts.join("\n");
				expect(allText).toContain("submitted Ada/b");

				// --- The report's contract shape reached the parent intact.
				expect(allText).toContain("Outcome: done");

				// --- Parent-side label humanization: the observed child tool calls
				// (captured from the bridge's tool_calls) produce informative labels.
				const navigateLabel = humanizeToolLabel("browser", { action: "navigate", url: fixture!.url });
				expect(navigateLabel).toBe(`browser: navigate 127.0.0.1:${new URL(fixture!.url).port}`);
				const clickLabel = humanizeToolLabel("browser", { action: "click", selector: "#go" });
				expect(clickLabel).toBe("browser: click #go");
			} finally {
				bridge.close();
			}
		},
		LONG,
	);

	// -------------------------------------------------------------------------
	// Scenario 3: browser missing → the terminal-failure contract
	// -------------------------------------------------------------------------
	test.skipIf(!RUN)(
		"browser binary missing: the child reports the verbatim remediation, Outcome: failed",
		async () => {
			const bridge = startMultiTurnBridge(
				[
					{
						toolCall: {
							name: "task",
							args: { agent: "browser", task: "Open http://127.0.0.1:1/nope and report." },
						},
					},
				{ text: "Report: ${LIVE_PAGE_TEXT}" },
				],
				[
					{ toolCall: { name: "browser", args: { action: "start" } } },
					{
						text: `Outcome: failed
Did:
- browser start failed — verbatim error: ${"${LIVE_PAGE_TEXT}"}
Pages:
- none
Notes:
- environment lacks a browser`,
					},
				],
			);
			try {
				const run = await unown(["--mode", "json", "-p", "Delegate."], {
					bridge,
					env: {
						UNOWN_NO_PREFLIGHT: "1",
						// Force discovery failure: the path exists but is no browser.
						UNOWN_BROWSER_PATH: "/nonexistent/no-chrome-here",
					},
					timeoutMs: 120_000,
				});
				expect(run.exitCode).toBe(0);
				const events = parseJsonl(run.stdout);
				const allText = events
					.filter((e) => e?.type === "message_end" && e?.message?.role === "assistant")
					.map((e) => String(e?.message?.content?.[0]?.text ?? ""))
					.join("\n");
				// The verbatim, actionable error reached the parent through the report.
				expect(allText).toContain("Outcome: failed");
				expect(allText).toContain("browser"); // the remediation names the browser problem
			} finally {
				bridge.close();
			}
		},
		LONG,
	);

	// -------------------------------------------------------------------------
	// Scenario 4: blocklist denial is policy — reported verbatim, not retried
	// -------------------------------------------------------------------------
	test.skipIf(!RUN)(
		"UNOWN_BROWSER_BLOCK denial reaches the child's report verbatim",
		async () => {
			const blockedHost = "blocked.invalid";
			const bridge = startMultiTurnBridge(
				[
					{
						toolCall: {
							name: "task",
							args: { agent: "browser", task: `Open https://${blockedHost}/x and report.` },
						},
					},
				{ text: "Report: ${LIVE_PAGE_TEXT}" },
				],
				[
					{ toolCall: { name: "browser", args: { action: "start" } } },
					{ toolCall: { name: "browser", args: { action: "navigate", url: `https://${blockedHost}/x` } } },
					{
						text: `Outcome: failed
Did:
- navigation denied — verbatim: ${"${LIVE_PAGE_TEXT}"}
Pages:
- none
Notes:
- policy denial`,
					},
				],
			);
			try {
				const run = await unown(["--mode", "json", "-p", "Delegate."], {
					bridge,
					env: {
						UNOWN_NO_PREFLIGHT: "1",
						UNOWN_BROWSER_BLOCK: blockedHost,
					},
					timeoutMs: 120_000,
				});
				expect(run.exitCode).toBe(0);
				const events = parseJsonl(run.stdout);
				const allText = events
					.filter((e) => e?.type === "message_end" && e?.message?.role === "assistant")
					.map((e) => String(e?.message?.content?.[0]?.text ?? ""))
					.join("\n");
				expect(allText).toContain("Outcome: failed");
			} finally {
				bridge.close();
			}
		},
		LONG,
	);

	// -------------------------------------------------------------------------
	// Scenario 5: the spawn shape — allowlist args + the 10-minute budget
	// -------------------------------------------------------------------------
	test("buildSubagentArgs + timeout: the browser agent spawns with its toolset and budget (pure)", () => {
		const agent = ROLE_BUILTIN_AGENTS.find((a) => a.name === "browser")!;
		const args = buildSubagentArgs(agent);
		expect(args).toContain("--tools");
		expect(args[args.indexOf("--tools") + 1]).toBe("browser,read,grep,find,ls");
		expect(args).toContain("--no-agents-md");
		// The 10-minute budget (double the 5-minute default; Gemini parity).
		expect(resolveSubagentTimeoutMs(agent, {})).toBe(600_000);
		// A session-wide override still loses to the per-agent budget.
		expect(resolveSubagentTimeoutMs(agent, { UNOWN_SUBAGENT_TIMEOUT_MS: "60000" })).toBe(600_000);
	});
});
