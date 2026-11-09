// plan-mode-flags.test.ts — the 2026-11-09 plan-mode × TUI combination round's
// flag-lane pins. The headline bug: `--plan-model <id>` and `--max-turns N`
// are parsed by cli.ts and handed to pi as extension flag values, but pi's
// loader only answers getFlag() for flags the calling extension REGISTERED —
// and nothing registered them. Both lanes were silent no-ops (measured live:
// every planning turn stayed on the session model; the plan-turn budget never
// saw the run cap), and applyExtensionFlagValues' "Unknown option" error
// diagnostic was swallowed by every bootRuntime caller destructuring
// { runtime } alone.
//
// Pins:
//   1. the extension registers plan-model + max-turns (string flags) alongside
//      plan + goal — unregistered names are dead-on-arrival by pi's contract
//   2. the --plan-model FLAG lane (not just the env lane) switches the model
//      on session_start and restores it when plan mode ends
//   3. the --max-turns budget read engages at call time: a 10-turn cap yields
//      a 6-turn planning budget (60%), and the escalation line renders
//   4. UNOWN_PLAN_TURN_BUDGET=0 disables the pressure (previously unreachable
//      dead code — the env value fell back to 15 before the <= 0 guard)
//   5. the --plan boot lane reaches parity with /plan: the entry notice
//      renders (TUI) and stays silent in print mode
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-plan-flags-test-"));
afterAll(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
	// Defense in depth: whatever an assertion path skipped, the global
	// fleet-activity latch (Symbol.for("unown-fleet-activity")) must not
	// leak busy-state into other suites sharing this process.
	const holders = globalThis as unknown as Record<symbol, { lastAt: number; turnActive: boolean }>;
	const key = Symbol.for("unown-fleet-activity");
	if (holders[key]) holders[key].turnActive = false;
});

type Handler = (event: any, ctx?: any) => any;

/** A fake pi that records flag registrations and can emit captured events. */
function makeFakePi(flags: Record<string, boolean | string> = {}, entries: any[] = []) {
	const handlers = new Map<string, Handler[]>();
	const registeredFlags = new Map<string, { type: string; description: string }>();
	const commands = new Map<string, { description: string; handler: Handler }>();
	const tools = new Map<string, any>();
	const sent: Array<{ message: any; options: any }> = [];
	const setModelCalls: Array<{ provider: string; id: string }> = [];
	const activeTools: string[] = ["read", "bash", "edit", "write", "todo", "task"];
	const pi: any = {
		on: (event: string, handler: Handler) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
		registerFlag: (name: string, def: { type: string; description?: string }) =>
			registeredFlags.set(name, { type: def.type, description: def.description ?? "" }),
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerShortcut: () => {},
		appendEntry: () => {},
		getFlag: (name: string) => flags[name],
		getActiveTools: () => [...activeTools],
		setActiveTools: (next: string[]) => {
			activeTools.length = 0;
			activeTools.push(...next);
		},
		sendMessage: (message: any, options: any) => sent.push({ message, options }),
		sendUserMessage: (text: string, options: any) =>
			sent.push({ message: { customType: "user", content: text }, options }),
		setModel: async (model: any) => {
			setModelCalls.push({ provider: model.provider, id: model.id });
			return true;
		},
		setSessionName: () => {},
	};
	const emit = async (event: string, payload: any, ctx?: any) => {
		let result: any;
		for (const h of handlers.get(event) ?? []) {
			const r = await h(payload, ctx);
			if (r !== undefined) result = r;
		}
		return result;
	};
	const ctx = {
		hasUI: true,
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
		sessionManager: { getEntries: () => entries, getSessionId: () => "s1", getBranch: () => [...entries] },
	};
	return { pi, emit, registeredFlags, commands, tools, sent, setModelCalls, activeTools, ctx };
}

function makeNoticingCtx(entries: any[] = []) {
	const notices: Array<{ text: string; level: string }> = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify: (text: string, level: string = "info") => notices.push({ text, level }),
			setStatus: () => {},
			setWidget: () => {},
			theme: { fg: (_n: string, t: string) => t },
		},
		sessionManager: { getEntries: () => entries, getSessionId: () => "s1", getBranch: () => [...entries] },
	};
	return { ctx, notices };
}

/** A minimal two-model registry for the plan-model split assertions. */
function makeRegistryCtx(base: any, entries: any[] = []) {
	const models = [
		{ provider: "agnes", id: "agnes-3.0-flash" },
		{ provider: "agnes", id: "agnes-2.5-flash" },
	];
	return {
		...base,
		model: models[0],
		modelRegistry: {
			find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
			getAvailable: () => models,
		},
		sessionManager: base.sessionManager ?? {
			getEntries: () => entries,
			getSessionId: () => "s1",
			getBranch: () => [...entries],
		},
	};
}

async function wire(flags: Record<string, boolean | string> = {}, entries: any[] = []) {
	const dir = join(tmpRoot, `ext-${Math.random().toString(36).slice(2)}`);
	const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:9" });
	const fake = makeFakePi(flags, entries);
	ext.factory(fake.pi as any);
	return { fake, dir };
}

describe("plan-mode flag registration (pi's loader contract)", () => {
	test("registers plan-model and max-turns as string flags alongside plan and goal", async () => {
		const { fake } = await wire();
		for (const name of ["plan", "goal", "plan-model", "max-turns"]) {
			expect(fake.registeredFlags.has(name)).toBe(true);
		}
		expect(fake.registeredFlags.get("plan-model")!.type).toBe("string");
		expect(fake.registeredFlags.get("max-turns")!.type).toBe("string");
		expect(fake.registeredFlags.get("plan")!.type).toBe("boolean");
		// The registrations must describe what they do — they are the
		// discoverable contract for `unown --help` writers.
		expect(fake.registeredFlags.get("plan-model")!.description).toContain("plan mode");
		expect(fake.registeredFlags.get("max-turns")!.description).toContain("plan-turn budget");
	});
});

describe("--plan-model (the opusplan lane)", () => {
	test("the FLAG lane switches the model on session_start and restores it when planning ends", async () => {
		const { fake } = await wire({ plan: true, "plan-model": "agnes-2.5-flash" });
		const noticing = makeNoticingCtx();
		const ctx = makeRegistryCtx(noticing.ctx);
		await fake.emit("session_start", {}, ctx);
		// the model split applied: planning rides the plan model...
		expect(fake.setModelCalls.length).toBe(1);
		expect(fake.setModelCalls[0]).toEqual({ provider: "agnes", id: "agnes-2.5-flash" });
		// ...and the boot lane notifies (parity with /plan — the 2026-11-09 fix)
		expect(noticing.notices.some((n) => n.text.startsWith("Plan mode ON"))).toBe(true);

		// leaving plan mode restores the session model
		await fake.commands.get("plan")!.handler("off", ctx);
		expect(fake.setModelCalls.length).toBe(2);
		expect(fake.setModelCalls[1]).toEqual({ provider: "agnes", id: "agnes-3.0-flash" });
	});

	test("the env lane (PI_PLAN_MODEL_ID) still applies when no flag is given", async () => {
		process.env.PI_PLAN_MODEL_ID = "agnes-2.5-flash";
		try {
			const { fake } = await wire({ plan: true });
			const noticing = makeNoticingCtx();
			const ctx = makeRegistryCtx(noticing.ctx);
			await fake.emit("session_start", {}, ctx);
			expect(fake.setModelCalls).toEqual([{ provider: "agnes", id: "agnes-2.5-flash" }]);
		} finally {
			delete process.env.PI_PLAN_MODEL_ID;
		}
	});

	test("the flag wins over the env var (documented precedence)", async () => {
		process.env.PI_PLAN_MODEL_ID = "agnes-3.0-flash";
		try {
			const { fake } = await wire({ plan: true, "plan-model": "agnes-2.5-flash" });
			const ctx = makeRegistryCtx(makeNoticingCtx().ctx);
			await fake.emit("session_start", {}, ctx);
			expect(fake.setModelCalls[0]).toEqual({ provider: "agnes", id: "agnes-2.5-flash" });
		} finally {
			delete process.env.PI_PLAN_MODEL_ID;
		}
	});

	test("an unknown plan model leaves the session model untouched (no crash)", async () => {
		const { fake } = await wire({ plan: true, "plan-model": "nonexistent-model-x" });
		const noticing = makeNoticingCtx();
		const ctx = makeRegistryCtx(noticing.ctx);
		await fake.emit("session_start", {}, ctx);
		expect(fake.setModelCalls.length).toBe(0);
		// the TUI warns; print mode (hasUI false) stays silent-but-alive
		expect(noticing.notices.some((n) => n.text.includes("not found — staying on"))).toBe(true);
	});
});

describe("--max-turns feeds the plan-turn budget (gap P-17)", () => {
	test("a 10-turn cap yields a 6-turn planning budget and the escalation line renders", async () => {
		const { fake } = await wire({ plan: true, "max-turns": "10" });
		const noticing = makeNoticingCtx();
		await fake.emit("session_start", {}, makeRegistryCtx(noticing.ctx));
		// four completed planning turns ≥ 50% of the 6-turn budget
		for (let i = 0; i < 4; i++) await fake.emit("turn_start", {}, undefined);
		// a narration-stop (no plan file, no question) triggers the nudge,
		// which carries the budget line
		await fake.emit(
			"agent_end",
			{ messages: [{ role: "assistant", content: [{ type: "text", text: "Looking at the code." }] }] },
			makeNoticingCtx().ctx,
		);
		const nudge = fake.sent.find((s) => s.message?.customType === "unown-plan-continue");
		expect(nudge).toBeDefined();
		expect(String(nudge!.message.content)).toContain("4/6");
	});

	test("UNOWN_PLAN_TURN_BUDGET=0 disables the pressure entirely (was unreachable dead code)", async () => {
		process.env.UNOWN_PLAN_TURN_BUDGET = "0";
		try {
			const { fake } = await wire({ plan: true });
			await fake.emit("session_start", {}, makeRegistryCtx(makeNoticingCtx().ctx));
			for (let i = 0; i < 12; i++) await fake.emit("turn_start", {}, undefined);
			await fake.emit(
				"agent_end",
				{ messages: [{ role: "assistant", content: [{ type: "text", text: "Still exploring." }] }] },
				makeNoticingCtx().ctx,
			);
			const nudge = fake.sent.find((s) => s.message?.customType === "unown-plan-continue");
			expect(nudge).toBeDefined();
			const content = String(nudge!.message.content);
			expect(content).not.toContain("BUDGET");
			expect(content).not.toContain("/6");
			expect(content).not.toContain("/15");
		} finally {
			delete process.env.UNOWN_PLAN_TURN_BUDGET;
		}
	});
});

describe("--plan boot-lane parity (the 2026-11-09 fix)", () => {
	test("the boot notice renders in the TUI lane and stays silent without UI", async () => {
		const { fake } = await wire({ plan: true });
		const noticing = makeNoticingCtx();
		await fake.emit("session_start", {}, makeRegistryCtx(noticing.ctx));
		expect(noticing.notices.some((n) => n.text.startsWith("Plan mode ON (V3 orchestrator)"))).toBe(true);

		const printCtx = { ...makeNoticingCtx().ctx, hasUI: false };
		const { fake: fake2 } = await wire({ plan: true });
		const silent = makeNoticingCtx();
		printCtx.ui = printCtx.ui ?? silent.ctx.ui;
		await fake2.emit("session_start", {}, makeRegistryCtx({ ...printCtx, hasUI: false }));
		expect(silent.notices.length).toBe(0);
	});

	test("V2 kill switch keeps the boot notice on the V2 wording", async () => {
		process.env.UNOWN_PLAN_MODE_V3 = "0";
		try {
			const { fake } = await wire({ plan: true });
			const noticing = makeNoticingCtx();
			await fake.emit("session_start", {}, makeRegistryCtx(noticing.ctx));
			expect(noticing.notices.some((n) => n.text.startsWith("Plan mode ON — read-only exploration"))).toBe(true);
		} finally {
			delete process.env.UNOWN_PLAN_MODE_V3;
		}
	});
});

// ---------------------------------------------------------------------------
// The stay-loop fix (2026-11-09): a STAYED approval outcome must keep the
// agent_end fallback gate quiet for the REST OF THE RUN. Measured live: the
// model's post-stay continuation turn fired turn_start (resetting the old
// per-turn suppression), the run ended, and the fallback gate re-opened
// within seconds — detaching the user's editor while they typed their next
// command (two eaten commands in one session). agent_start re-arms.
// ---------------------------------------------------------------------------

const STAY_PLAN = `# Plan: Add the export button

## Context
The dashboard needs an export button next to the filter bar (files: src/dashboard.tsx).

## Approach
Add a button component wired to the existing export API endpoint.

## Steps
1. Add the button component (files: src/button.tsx)
2. Wire the click handler to the export API (files: src/dashboard.tsx)

## Risks
- API rate limits under large exports.

## Verification
- bun test src
`;

describe("the stay-loop latch (planGateStayedForRun)", () => {
	async function wireForStay() {
		const { fake, dir } = await wire({});
		const { ctx, notices } = makeNoticingCtx();
		// enter plan mode with a description (seeds the plan file identity)
		await fake.commands.get("plan")!.handler("add the export button", ctx);
		// write the plan file through the real plan_write tool
		const planWrite = fake.tools.get("plan_write")!;
		await planWrite.execute("t1", { content: STAY_PLAN }, undefined, undefined, ctx);
		return { fake, dir, ctx, notices };
	}

	function makeSelectingCtx(base: any, script: Array<string | undefined>) {
		const selects: Array<{ title: string; options: string[] }> = [];
		let call = 0;
		const ctx = {
			...base,
			ui: {
				...base.ui,
				select: async (title: string, options: string[]) => {
					selects.push({ title, options });
					return script[call++];
				},
				editor: async () => STAY_PLAN,
				input: async () => "tighten the verification steps",
			},
		};
		return { ctx, selects };
	}

	test("a stayed gate does NOT re-offer at the next agent_end of the same run", async () => {
		const wired = await wireForStay();
		const sel = makeSelectingCtx(wired.ctx, [undefined]); // dialog dismissed -> stayed
		const exit = wired.fake.tools.get("exit_plan_mode")!;
		const result = await exit.execute("t2", {}, undefined, undefined, sel.ctx);
		expect(JSON.stringify(result)).toContain("keep planning");
		expect(sel.selects).toHaveLength(1);

		// the model's post-stay continuation: a new turn, then the run ends
		await wired.fake.emit("turn_start", {}, undefined);
		await wired.fake.emit(
			"agent_end",
			{ messages: [{ role: "assistant", content: [{ type: "text", text: "Plan is written and scored." }] }] },
			wired.ctx,
		);
		// the fallback gate must NOT have re-opened (no second select)
		expect(sel.selects).toHaveLength(1);
	});

	test("a rejected-with-feedback gate DOES re-arm per turn (the fallback rescues a forgotten re-offer)", async () => {
		const wired = await wireForStay();
		const sel = makeSelectingCtx(wired.ctx, ["Keep planning (send feedback)"]);
		const exit = wired.fake.tools.get("exit_plan_mode")!;
		await exit.execute("t3", {}, undefined, undefined, sel.ctx);
		expect(sel.selects).toHaveLength(1);

		// the model revises across a new turn, forgets to re-offer, run ends
		await wired.fake.emit("turn_start", {}, undefined);
		await wired.fake.emit(
			"agent_end",
			{ messages: [{ role: "assistant", content: [{ type: "text", text: "Revised the plan file." }] }] },
			sel.ctx,
		);
		// the fallback gate re-opened — the designed gap-P-04 rescue
		expect(sel.selects).toHaveLength(2);
	});

	test("agent_start re-arms the latch: the next run may re-offer", async () => {
		const wired = await wireForStay();
		const sel = makeSelectingCtx(wired.ctx, [undefined, undefined]);
		const exit = wired.fake.tools.get("exit_plan_mode")!;
		await exit.execute("t4", {}, undefined, undefined, sel.ctx);
		await wired.fake.emit("turn_start", {}, undefined);
		await wired.fake.emit(
			"agent_end",
			{ messages: [{ role: "assistant", content: [{ type: "text", text: "Waiting for the user." }] }] },
			sel.ctx,
		);
		expect(sel.selects).toHaveLength(1); // stayed — quiet

		// the user sends a new message: a fresh agent run re-arms everything
		await wired.fake.emit("agent_start", {}, undefined);
		await wired.fake.emit(
			"agent_end",
			{ messages: [{ role: "assistant", content: [{ type: "text", text: "Still waiting." }] }] },
			sel.ctx,
		);
		expect(sel.selects).toHaveLength(2); // the fallback gate may re-offer again
		// restore the global fleet-activity latch: registerFleetSurface (wired
		// into every unown-tools factory) sets turnActive=true on agent_start
		// and clears it on agent_settled — firing one without the other leaks
		// busy-state into isFleetBusy() for every later test in this process.
		await wired.fake.emit("agent_settled", {}, undefined);
	});

	test("while the latch is set, the model's own exit_plan_mode re-offer answers softly (no dialog)", async () => {
		const wired = await wireForStay();
		const sel = makeSelectingCtx(wired.ctx, [undefined, "Execute — auto-accept edits"]);
		const exit = wired.fake.tools.get("exit_plan_mode")!;
		await exit.execute("t5", {}, undefined, undefined, sel.ctx); // stayed -> latch set
		expect(sel.selects).toHaveLength(1);

		// the model re-offers within the same run: soft answer, NO dialog
		const again = await exit.execute("t6", {}, undefined, undefined, sel.ctx);
		expect(sel.selects).toHaveLength(1);
		expect(JSON.stringify(again)).toContain("do NOT re-offer the plan now");

		// agent_start — the user's next message — re-arms the in-tool gate
		await wired.fake.emit("agent_start", {}, undefined);
		await exit.execute("t7", {}, undefined, undefined, sel.ctx);
		expect(sel.selects).toHaveLength(2);
		// same global-latch restore as above
		await wired.fake.emit("agent_settled", {}, undefined);
	});
});
