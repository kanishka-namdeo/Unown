/**
 * dashboard-boot.ts — the standalone mount: `unown dashboard [screen]`.
 *
 * Owns the process: seeds/reads the unown agent dir (brand theme), points
 * pi's agent-dir resolution at it, boots the alt-screen TUI with the
 * DashboardApp as the layout root, and drains cleanly on exit (SSE off,
 * terminal restored — the same discipline as the chat TUI's exit path).
 *
 * Cross-platform by construction: ProcessTerminal + TuiAltScreen carry the
 * win32 console-mode and darwin modifier prebuilds; nothing here touches
 * POSIX-only APIs, and both runtime shapes (checkout + compiled binary) boot
 * identically because this module never assumes a writable import.meta.dir.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { initTheme, theme } from "@earendil-works/pi-coding-agent";
import { DashboardStore } from "./dashboard-data.ts";
import { DashboardApp } from "./dashboard-app.ts";
import { ensureUnownAgentDirInfo, UNOWN_AGENT_DIR } from "../term.ts";

/** Boot the standalone dashboard. Returns a promise that resolves with the
 * process exit code when the user quits. */
export async function runDashboardCommand(args: string[]): Promise<number> {
	if (!process.stdout.isTTY || !process.stdin.isTTY) {
		process.stderr.write(
			"unown dashboard needs an interactive terminal (TTY).\n" +
				"  · run it directly in your terminal: unown dashboard\n" +
				"  · from a script, use the engine API instead: curl localhost:3030/api/overview\n",
		);
		return 1;
	}
	const initialScreen = args.find((a) => !a.startsWith("-"));

	// Agent dir + theme: the same seeding the chat TUI does on first run
	// (never clobbers user edits), then pi's sanctioned agent-dir override so
	// theme discovery + settings read from ~/.unown/agent (cli.ts M3 pattern).
	ensureUnownAgentDirInfo();
	process.env.PI_CODING_AGENT_DIR = UNOWN_AGENT_DIR;
	let themeName: string | undefined;
	try {
		const settings = JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "settings.json"), "utf8")) as {
			theme?: string;
		};
		themeName = typeof settings.theme === "string" && settings.theme ? settings.theme : undefined;
	} catch {
		themeName = undefined;
	}
	initTheme(themeName);

	const terminal = new ProcessTerminal();
	const tui = new TuiAltScreen(terminal);
	const store = new DashboardStore();

	let finished = false;
	let resolveExit: (() => void) | null = null;
	const exited = new Promise<void>((resolve) => {
		resolveExit = resolve;
	});

	const shutdown = (): void => {
		if (finished) return;
		finished = true;
		try {
			store.stop();
		} catch {
			/* drain errors never block the exit path */
		}
		try {
			tui.stop({ preserveScreen: false });
		} catch {
			/* the terminal restore is best-effort; the OS cleans up on exit */
		}
		resolveExit?.();
	};

	const app = new DashboardApp(tui, {
		theme,
		store,
		embedded: false,
		onExit: shutdown,
		initialScreen,
	});

	// Signals: the TUI owns Ctrl-C (the app handles it as quit); SIGTERM (and
	// any late SIGINT) drains through the same path on every platform.
	process.once("SIGTERM", () => shutdown());
	process.once("SIGINT", () => {
		// If the app already handled Ctrl-C as quit, this never fires; if the
		// TUI passed it through, exit now.
		shutdown();
	});

	tui.setLayoutRoot(app);
	tui.setFocus(app);
	store.start();
	app.start();
	tui.start();

	await exited;
	return 0;
}
