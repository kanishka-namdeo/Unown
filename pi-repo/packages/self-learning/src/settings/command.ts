/**
 * settings/command.ts — the /settings command surface.
 *
 * `/settings` opens the interactive hub (TUI) and supports headless-safe
 * subcommands: status · search <q> · health · diff · recent [n] · export
 * [path] · import <path> · reset <scope>. The command OVERRIDES the pi
 * built-in /settings (theme selector) through the vendored
 * extension-override patch — the hub's Agent → Interface group covers those
 * rows, so nothing is lost and everything is organized.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderDiff, renderHealth, renderHelp, renderRecent, renderSearch, renderStatus } from "./render.ts";
import { runSettingsHub } from "./ui.ts";
import { exportSettings, importSettings, resetSettings, type ResetScope } from "./transfer.ts";

export interface SettingsCommandOptions {
	cwd: string;
	unownVersion?: string;
}

const SUBCOMMANDS = new Set(["status", "search", "health", "diff", "recent", "export", "import", "reset", "help"]);

export function registerSettingsCommand(pi: ExtensionAPI, opts: SettingsCommandOptions): void {
	pi.registerCommand("settings", {
		description: "The settings control centre: 10 intent-ordered sections, search, recently changed, health, recovery (status|search|health|diff|recent|export|import|reset)",
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			const trimmed = (args ?? "").trim();
			const [head, ...rest] = trimmed ? trimmed.split(/\s+/) : [];
			const restJoined = rest.join(" ");

			if (!head) {
				if (!ctx.hasUI || ctx.mode !== "tui") {
					ctx.ui.notify(await renderStatus(), "info");
					ctx.ui.notify("(headless mode — the interactive hub needs a TTY; subcommands: status|search|health|diff|recent|export|import|reset)", "info");
					return;
				}
				await runSettingsHub(ctx, opts);
				return;
			}

			switch (head) {
				case "status":
					ctx.ui.notify(await renderStatus(), "info");
					return;
				case "search": {
					if (!restJoined) {
						ctx.ui.notify("Usage: /settings search <query>", "warning");
						return;
					}
					ctx.ui.notify(await renderSearch(restJoined), "info");
					return;
				}
				case "health":
					ctx.ui.notify(await renderHealth(opts.cwd), "info");
					return;
				case "diff":
					ctx.ui.notify(await renderDiff(), "info");
					return;
				case "recent": {
					const n = Number(rest[0]);
					ctx.ui.notify(renderRecent(Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 100) : 10), "info");
					return;
				}
				case "export": {
					const path = restJoined || "unown-settings.json";
					const result = exportSettings(path, opts.unownVersion);
					ctx.ui.notify(
						result.ok ? `Exported settings bundle → ${result.path}` : `Export failed: ${result.error}`,
						result.ok ? "info" : "error",
					);
					return;
				}
				case "import": {
					if (!restJoined) {
						ctx.ui.notify("Usage: /settings import <path>", "warning");
						return;
					}
					const result = importSettings(restJoined, "/settings import");
					ctx.ui.notify(
						`Import ${result.ok ? "applied" : "failed"}${result.error ? `: ${result.error}` : ""}\nApplied: ${result.applied.join(", ") || "(nothing)"}\nSkipped: ${result.skipped.join("; ") || "(none)"}\nBackup: ${result.backupPath ?? "-"}`,
						result.ok ? "info" : "error",
					);
					return;
				}
				case "reset": {
					const scope = (rest[0] ?? "") as ResetScope;
					if (!["hub", "addons", "pi", "all"].includes(scope)) {
						ctx.ui.notify("Usage: /settings reset <hub|addons|pi|all> — a backup is written first", "warning");
						return;
					}
					const result = resetSettings(scope, "/settings reset");
					ctx.ui.notify(`Reset done (backup: ${result.backupPath})\n${result.reset.join("\n")}`, "info");
					return;
				}
				case "help":
				default: {
					if (!SUBCOMMANDS.has(head)) {
						ctx.ui.notify(`Unknown subcommand "${head}"\n\n${renderHelp()}`, "warning");
						return;
					}
					ctx.ui.notify(renderHelp(), "info");
				}
			}
		},
	});
}
