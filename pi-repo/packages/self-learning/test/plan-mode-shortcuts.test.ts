// plan-mode-shortcuts.test.ts — the plan-mode keyboard round's extension-side
// pins. The headline bug (2026-10-31): the unown extension registers
// Shift+Tab for permission-mode cycling, but ExtensionRunner.getShortcuts
// drops extension shortcuts whose key collides with a reserved built-in
// default — app.thinking.cycle defaulted to shift+tab, so on every fresh
// install the plan-mode cycle was DEAD (shift+tab cycled thinking levels
// instead; docs/usage.md even documented the same key twice with contradictory
// meanings). The vendored default now lives on alt+t.
//
// Pins:
//   1. the extension registers shift+tab (the Claude Code / Gemini lane)
//      and ctrl+alt+p (the toggle) with their documented descriptions
//   2. the shift+tab handler walks the full cycle: default → acceptEdits →
//      plan → default, driving the permission seam and the toolset switch
//   3. a refused permission seam (bypassPermissions) degrades to the honest
//      "unchanged" notice instead of a silent no-op
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-plan-keys-test-"));
afterAll(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
	const commands = new Map<string, { description: string; handler: Handler }>();
	const shortcuts = new Map<string, { description?: string; handler: Handler }>();
	const calls: string[] = [];
	let activeTools: string[] = ["read", "bash", "edit", "write", "task", "grep", "glob"];
	const pi: any = {
		on: () => {},
		registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
		registerFlag: () => {},
		registerTool: () => {},
		registerShortcut: (key: string, def: { description?: string; handler: Handler }) =>
			shortcuts.set(key, def),
		appendEntry: () => {},
		getFlag: () => undefined,
		getActiveTools: () => activeTools,
		setActiveTools: (tools: string[]) => {
			calls.push(`setActiveTools:${tools.join(",")}`);
			activeTools = tools;
		},
		sendMessage: () => {},
		setModel: async () => true,
	};
	return { pi, commands, shortcuts, calls, getActiveTools: () => activeTools };
}

/** Minimal TUI ctx for the plan-mode state machine: notify, status, widget. */
function makeCtx() {
	const notices: Array<{ text: string; level: string }> = [];
	const statuses: Array<[string, string | undefined]> = [];
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			notify: (text: string, level: string = "info") => notices.push({ text, level }),
			setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
			setWidget: () => {},
			theme: { fg: (_name: string, text: string) => text },
		},
	};
	return { ctx, notices, statuses };
}

interface SeamState {
	mode: "default" | "acceptEdits" | "bypassPermissions";
	applied: boolean;
	note?: string;
}

function makeSeams(initial: SeamState["mode"]) {
	const state: SeamState = { mode: initial, applied: true };
	const setCalls: string[] = [];
	const setPermissionMode = (mode: string) => {
		setCalls.push(mode);
		if (state.mode === "bypassPermissions") {
			return { applied: false, note: "bypassPermissions is pinned by policy", effectiveMode: state.mode };
		}
		state.mode = mode as SeamState["mode"];
		return { applied: true, effectiveMode: state.mode };
	};
	const permissionsStatus = () => ({ mode: state.mode });
	return { setPermissionMode, permissionsStatus, setCalls, state };
}

async function wire(mode: SeamState["mode"] = "default") {
	const dir = join(tmpRoot, `ext-${Math.random().toString(36).slice(2)}`);
	const seams = makeSeams(mode);
	const ext = createUnownToolsExtension({
		cwd: dir,
		engineUrl: "http://127.0.0.1:9",
		setPermissionMode: seams.setPermissionMode,
		permissionsStatus: seams.permissionsStatus,
	});
	const fake = makeFakePi();
	ext.factory(fake.pi as any);
	return { fake, seams };
}

describe("plan-mode keyboard shortcuts (the unown-tools extension)", () => {
	test("registers shift+tab and ctrl+alt+p with their documented descriptions", async () => {
		const { fake } = await wire();
		expect(fake.shortcuts.has("shift+tab")).toBe(true);
		expect(fake.shortcuts.get("shift+tab")!.description).toContain("Cycle permission mode");
		expect(fake.shortcuts.get("shift+tab")!.description).toContain("acceptEdits");
		expect(fake.shortcuts.get("shift+tab")!.description).toContain("plan");
		expect(fake.shortcuts.has("ctrl+alt+p")).toBe(true);
		expect(fake.shortcuts.get("ctrl+alt+p")!.description).toBe("Toggle plan mode");
	});

	test("shift+tab walks the full cycle: default → acceptEdits → plan → default", async () => {
		const { fake, seams } = await wire("default");
		const handler = fake.shortcuts.get("shift+tab")!.handler;
		const { ctx, notices } = makeCtx();

		// default → acceptEdits: the seam is driven, the user is told what's next.
		await handler(ctx);
		expect(seams.setCalls).toEqual(["acceptEdits"]);
		expect(seams.state.mode).toBe("acceptEdits");
		expect(notices.at(-1)?.text).toContain("acceptEdits");
		expect(notices.at(-1)?.text).toContain("plan mode");

		// acceptEdits → plan: the toolset flips to the read-only plan set.
		await handler(ctx);
		expect(seams.setCalls).toEqual(["acceptEdits"]);
		expect(fake.getActiveTools()).toContain("plan_write");
		expect(fake.getActiveTools()).toContain("exit_plan_mode");
		expect(fake.getActiveTools()).not.toContain("edit");
		expect(notices.at(-1)?.text).toContain("Plan mode ON");

		// plan → default: tools restored, seam reset to default, plan file cleared.
		await handler(ctx);
		expect(seams.setCalls).toEqual(["acceptEdits", "default"]);
		expect(seams.state.mode).toBe("default");
		expect(fake.getActiveTools()).toContain("edit");
		expect(fake.getActiveTools()).not.toContain("plan_write");
		expect(notices.at(-1)?.text).toContain("Plan mode OFF");
	});

	test("a refused permission seam degrades to the honest 'unchanged' notice", async () => {
		const { fake, seams } = await wire("bypassPermissions");
		const handler = fake.shortcuts.get("shift+tab")!.handler;
		const { ctx, notices } = makeCtx();
		await handler(ctx);
		expect(seams.state.mode).toBe("bypassPermissions");
		expect(notices.at(-1)?.level).toBe("warning");
		expect(notices.at(-1)?.text).toContain("unchanged");
	});

	test("ctrl+alt+p toggles plan mode on and off", async () => {
		const { fake } = await wire("default");
		const handler = fake.shortcuts.get("ctrl+alt+p")!.handler;
		const { ctx, notices } = makeCtx();
		await handler(ctx);
		expect(fake.getActiveTools()).toContain("plan_write");
		expect(notices.at(-1)?.text).toContain("Plan mode ON");
		await handler(ctx);
		expect(fake.getActiveTools()).not.toContain("plan_write");
		expect(notices.at(-1)?.text).toContain("Plan mode OFF");
	});
});
