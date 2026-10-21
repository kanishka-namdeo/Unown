// tools-update-chip.test.ts — the TUI footer chip: binary-only, skip/snooze
// aware, and refreshed from the cache the detached check writes.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeInstallMetadata } from "../src/install-layout.ts";
import { createUnownToolsExtension } from "../src/tools.ts";
import { type UpdateCheckCache, writeUpdateCheckCache, writeUpdatePrefs } from "../src/update-status.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-update-chip-"));
const savedHome = process.env.UNOWN_HOME;
const savedRoot = process.env.UNOWN_INSTALL_ROOT;
afterAll(() => {
	process.env.UNOWN_HOME = savedHome;
	process.env.UNOWN_INSTALL_ROOT = savedRoot;
	rmSync(TMP, { recursive: true, force: true });
});

function makeFakePi() {
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
	const emit = async (event: string, ctx: any) => {
		for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
	};
	return { pi, emit };
}

function setupInstall(mode: "binary" | "checkout") {
	const base = mkdtempSync(join(TMP, "case-"));
	const home = join(base, "home");
	const root = join(base, "root");
	mkdirSync(join(root, "versions", "0.0.1"), { recursive: true });
	process.env.UNOWN_HOME = home;
	if (mode === "binary") process.env.UNOWN_INSTALL_ROOT = root;
	else delete process.env.UNOWN_INSTALL_ROOT;
	writeInstallMetadata(home, {
		schema: 1,
		mode,
		version: "0.0.1",
		...(mode === "binary" ? { platform: "linux-x64" } : {}),
		root,
		bin: join(root, "versions", "0.0.1", "unown"),
		shim: join(base, "bin", "unown"),
		installedAt: "2026-10-21T12:00:00.000Z",
	});
	return { home, root };
}

function cache(mode: "binary" | "checkout" = "binary"): UpdateCheckCache {
	return {
		schema: 2,
		checkedAt: new Date().toISOString(),
		current: "0.0.1",
		mode,
		...(mode === "binary" ? { platform: "linux-x64" as const } : {}),
		latest: "0.0.2",
		applicable: true,
		...(mode === "checkout" ? { headBranch: "main", headTag: null, dirty: false, ahead: 0 } : {}),
	};
}

async function boot(ctxMode: string, isSubagent = false) {
	const statuses: Array<{ key: string; text: string | undefined }> = [];
	const ctx = {
		hasUI: true,
		mode: ctxMode,
		ui: {
			notify: () => {},
			setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
			setWidget: () => {},
		},
		sessionManager: { getEntries: () => [] },
	};
	const ext = createUnownToolsExtension({ cwd: TMP, engineUrl: "http://127.0.0.1:3030", isSubagent });
	const fake = makeFakePi();
	ext.factory(fake.pi);
	await fake.emit("session_start", ctx);
	return { statuses, fake, ctx };
}

function chip(statuses: Array<{ key: string; text: string | undefined }>): string | undefined {
	const rows = statuses.filter((s) => s.key === "update");
	return rows.length ? rows[rows.length - 1].text : undefined;
}

describe("update footer chip", () => {
	test("a binary install with an applicable update sets the chip", async () => {
		const { home } = setupInstall("binary");
		writeUpdateCheckCache(home, cache());
		writeUpdatePrefs(home, { schema: 1 });
		const { statuses, fake, ctx } = await boot("tui");
		expect(chip(statuses)).toBe("update: 0.0.2");
		await fake.emit("session_shutdown", ctx);
	});

	test("a skipped or snoozed version clears it", async () => {
		const { home } = setupInstall("binary");
		writeUpdateCheckCache(home, cache());
		writeUpdatePrefs(home, { schema: 1, skippedVersion: "0.0.2" });
		const { statuses, fake, ctx } = await boot("tui");
		expect(chip(statuses)).toBeUndefined();
		await fake.emit("session_shutdown", ctx);

		const snoozed = setupInstall("binary");
		writeUpdateCheckCache(snoozed.home, cache());
		writeUpdatePrefs(snoozed.home, { schema: 1, snoozeUntil: new Date(Date.now() + 60_000).toISOString() });
		const second = await boot("tui");
		expect(chip(second.statuses)).toBeUndefined();
		await second.fake.emit("session_shutdown", second.ctx);
	});

	test("a checkout install never gets a chip", async () => {
		const { home } = setupInstall("checkout");
		writeUpdateCheckCache(home, cache("checkout"));
		writeUpdatePrefs(home, { schema: 1 });
		const { statuses, fake, ctx } = await boot("tui");
		expect(chip(statuses)).toBeUndefined();
		await fake.emit("session_shutdown", ctx);
	});

	test("subagents, non-TUI modes and opt-outs never arm the chip", async () => {
		const { home } = setupInstall("binary");
		writeUpdateCheckCache(home, cache());
		writeUpdatePrefs(home, { schema: 1 });
		const subagent = await boot("tui", true);
		expect(chip(subagent.statuses)).toBeUndefined();
		await subagent.fake.emit("session_shutdown", subagent.ctx);

		const print = await boot("print");
		expect(chip(print.statuses)).toBeUndefined();
		await print.fake.emit("session_shutdown", print.ctx);

		process.env.NO_UPDATE_NOTIFIER = "1";
		try {
			const optedOut = await boot("tui");
			expect(chip(optedOut.statuses)).toBeUndefined();
			await optedOut.fake.emit("session_shutdown", optedOut.ctx);
		} finally {
			delete process.env.NO_UPDATE_NOTIFIER;
		}
	});

	test("the 5s poll picks up a cache the detached check writes later", async () => {
		const { home } = setupInstall("binary");
		writeUpdatePrefs(home, { schema: 1 });
		const { statuses, fake, ctx } = await boot("tui");
		expect(chip(statuses)).toBeUndefined();
		writeUpdateCheckCache(home, cache());
		await new Promise((resolve) => setTimeout(resolve, 5_400));
		expect(chip(statuses)).toBe("update: 0.0.2");
		await fake.emit("session_shutdown", ctx);
	}, 15_000);
});
