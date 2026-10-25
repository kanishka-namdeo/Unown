// tools-install-surface.test.ts — the install receipt reaching a live session:
// the one-shot card and the "no model connected" footer pill, driven through
// the real extension's session_start (same harness shape as
// tools-update-chip.test.ts).
//
// This is the wiring test: install-surface.test.ts pins the renderers and the
// latch, and this pins that a TUI boot actually paints them, that the latch only
// moves once the card reached the pane, and that a subagent or a pipe stays
// silent. The suite's PI_BRIDGE_URL points at a dead port (_env.ts), so the
// bridge probe answers "down" fast and the pill's bridge wording is covered by
// install-surface.test.ts instead.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeInstallMetadata } from "../src/install-layout.ts";
import { UNOWN_AGENT_DIR } from "../src/term.ts";
import { createUnownToolsExtension } from "../src/tools.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-install-surface-"));
const savedHome = process.env.UNOWN_HOME;
const savedRoot = process.env.UNOWN_INSTALL_ROOT;
afterAll(() => {
	if (savedHome === undefined) delete process.env.UNOWN_HOME;
	else process.env.UNOWN_HOME = savedHome;
	if (savedRoot === undefined) delete process.env.UNOWN_INSTALL_ROOT;
	else process.env.UNOWN_INSTALL_ROOT = savedRoot;
	rmSync(TMP, { recursive: true, force: true });
});

/** A fresh UNOWN_HOME with a receipt, and no agent dir (so: no provider). */
function setupInstall(mode: "binary" | "checkout", version = "0.0.16"): string {
	const base = mkdtempSync(join(TMP, "case-"));
	const home = join(base, "home");
	const root = mode === "binary" ? join(base, "root") : join(base, "Unown");
	mkdirSync(root, { recursive: true });
	process.env.UNOWN_HOME = home;
	process.env.UNOWN_INSTALL_ROOT = root;
	writeInstallMetadata(home, {
		schema: 1,
		mode,
		version,
		...(mode === "binary" ? { platform: "linux-x64" } : {}),
		root,
		bin: join(root, mode === "binary" ? "unown" : "bin/unown"),
		shim: join(base, "bin", "unown"),
		installedAt: "2026-10-25T09:00:00.000Z",
	});
	return home;
}

/** The pill reads the agent dir the extension itself uses — term.ts fixes it at
 *  module load (the suite's redirected UNOWN_HOME), so a per-case env override
 *  cannot move it. The provider file is therefore placed there directly, and
 *  removed again so the pill cases stay order-independent. */
function agentModelsFile(body: string | null): void {
	mkdirSync(UNOWN_AGENT_DIR, { recursive: true });
	const file = join(UNOWN_AGENT_DIR, "models.json");
	if (body === null) rmSync(file, { force: true });
	else writeFileSync(file, body, "utf8");
}

async function boot(home: string, ctxMode = "tui", isSubagent = false) {
	const statuses: Array<{ key: string; text: string | undefined }> = [];
	const notifications: string[] = [];
	const ctx = {
		hasUI: true,
		mode: ctxMode,
		ui: {
			notify: (text: string) => notifications.push(text),
			setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
			setWidget: () => {},
			theme: { fg: (_c: string, t: string) => t },
		},
		sessionManager: { getEntries: () => [], getSessionId: () => "s", getSessionName: () => undefined },
		getModel: () => undefined,
		getThinkingLevel: () => undefined,
		getFlag: () => undefined,
	};
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const pi: any = {
		on: (event: string, handler: (event: any, ctx: any) => unknown) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		registerCommand: () => {},
		registerFlag: () => {},
		registerTool: () => {},
		registerShortcut: () => {},
		appendEntry: () => {},
		getFlag: () => undefined,
		getActiveTools: () => ["read", "bash", "edit", "write"],
		setActiveTools: () => {},
		sendMessage: () => {},
	};
	const ext = createUnownToolsExtension({ cwd: home, engineUrl: "http://127.0.0.1:9", isSubagent });
	ext.factory(pi);
	for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
	const model = statuses.filter((s) => s.key === "model");
	return {
		notifications,
		card: notifications.find((n) => n.includes("· binary install") || n.includes("· source checkout")),
		pill: model.length ? model[model.length - 1].text : undefined,
	};
}

describe("install card at session_start", () => {
	test("the first TUI session of an install shows it, the next one does not", async () => {
		const home = setupInstall("binary");
		const first = await boot(home);
		expect(first.card).toContain("channel: standalone CLI");
		expect(first.card).toContain("on PATH:");
		expect(first.card).toContain("installed: 2026-10-25 09:00 UTC");

		const second = await boot(home);
		expect(second.card).toBeUndefined();
	});

	test("a checkout receipt describes the full stack", async () => {
		const home = setupInstall("checkout");
		const { card } = await boot(home);
		expect(card).toContain("source checkout");
		expect(card).toContain("channel: full stack from a git clone");
	});

	test("an update re-shows the card for the new recorded version", async () => {
		const home = setupInstall("binary", "0.0.16");
		expect((await boot(home)).card).toBeDefined();
		writeInstallMetadata(home, {
			schema: 1,
			mode: "binary",
			version: "0.0.17",
			platform: "linux-x64",
			root: join(home, "..", "root"),
			bin: join(home, "..", "root", "unown"),
			shim: join(home, "..", "bin", "unown"),
			previousVersion: "0.0.16",
			installedAt: "2026-10-26T09:00:00.000Z",
		});
		const next = await boot(home);
		expect(next.card).toContain("v0.0.17");
		expect(next.card).toContain("from v0.0.16");
	});

	test("print mode and subagents stay silent — and spend nothing", async () => {
		const home = setupInstall("binary");
		expect((await boot(home, "print")).card).toBeUndefined();
		expect((await boot(home, "tui", true)).card).toBeUndefined();
		// Neither non-TUI path latched the card: the interactive boot still shows it.
		expect((await boot(home, "tui")).card).toBeDefined();
	});

	test("no receipt (a bare dev run) shows no card", async () => {
		const base = mkdtempSync(join(TMP, "no-receipt-"));
		process.env.UNOWN_HOME = base;
		expect((await boot(base)).card).toBeUndefined();
	});
});

describe("model pill at session_start", () => {
	const PROVIDER = JSON.stringify({ providers: { agnes: { models: [{ id: "agnes-3.0-flash" }] } } });

	test("set while the agent dir has no provider", async () => {
		const home = setupInstall("binary");
		agentModelsFile(null);
		try {
			expect((await boot(home)).pill).toBe("no model connected · /setup");
		} finally {
			agentModelsFile(null);
		}
	});

	test("absent once a provider is configured", async () => {
		const home = setupInstall("binary");
		agentModelsFile(PROVIDER);
		try {
			expect((await boot(home)).pill).toBeUndefined();
		} finally {
			agentModelsFile(null);
		}
	});

	test("silent in print mode and in a subagent, loud in a TUI", async () => {
		const home = setupInstall("binary");
		agentModelsFile(null);
		try {
			// The positive control first: the same install DOES earn the pill in a
			// TUI, so the two negatives below say "not painted here", not "nothing
			// to report anywhere".
			expect((await boot(home, "tui")).pill).toBe("no model connected · /setup");
			expect((await boot(home, "print")).pill).toBeUndefined();
			expect((await boot(home, "tui", true)).pill).toBeUndefined();
		} finally {
			agentModelsFile(null);
		}
	});
});
