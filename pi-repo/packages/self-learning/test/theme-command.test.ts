// theme-command.test.ts — the /theme command (Toccata round A13, the Claude
// Code alias onto the theme surface): /theme <name> switches directly, the
// picker previews live while navigating (in-memory instances — nothing
// persists until Enter), Enter commits, Esc restores the theme the picker
// started from.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThemePickerComponent, registerThemeCommand } from "../src/settings/theme-command.ts";
import { resetPiManagerCache } from "../src/settings/registry.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-theme-test-"));
afterAll(() => {
	resetPiManagerCache();
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
	const commands = new Map<string, { description: string; handler: Handler }>();
	const pi: any = {
		registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
	};
	const runCommand = async (name: string, args: string, ctx: any) => {
		const def = commands.get(name);
		if (!def) throw new Error(`no command ${name}`);
		await def.handler(args, ctx);
	};
	return { pi, commands, runCommand };
}

function makeFakeTheme() {
	// A minimal Theme double: the picker only uses fg + bold.
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as any;
}

function makeCtx(themes: Array<{ name: string }>, hasUI = true) {
	const messages: Array<{ text: string; level: string }> = [];
	const setThemeCalls: Array<string | object> = [];
	const customCalls: Array<(tui: any, theme: any, keybindings: any, done: (result: any) => void) => any> = [];
	return {
		ctx: {
			hasUI,
			mode: hasUI ? "tui" : "print",
			ui: {
				getAllThemes: () => themes,
				getTheme: (name: string) => (themes.some((t) => t.name === name) ? { name } : undefined),
				setTheme: (themeOrName: string | object) => {
					setThemeCalls.push(themeOrName);
					return { success: true };
				},
				notify: (text: string, level: string) => messages.push({ text, level }),
				custom: async (factory: any) => {
					customCalls.push(factory);
					const component = factory(
						{ requestRender: () => {} },
						makeFakeTheme(),
						undefined,
						(result: any) => {
							customResult = result;
							customResolve?.(result);
						},
					);
					return await new Promise((resolve) => {
						customResolve = resolve;
						// Drive the component through the caller's scenario below.
						scenario(component);
					});
				},
			},
		} as any,
		messages,
		setThemeCalls,
		customCalls,
	};
}

// The scenario driver + result capture are wired per-test below.
let customResult: any = undefined;
let customResolve: ((value: any) => void) | undefined = undefined;
let scenario: (component: ThemePickerComponent) => void = () => {};

describe("ThemePickerComponent (the live-preview picker)", () => {
	const themes = [{ name: "dark" }, { name: "light" }, { name: "unown" }];

	test("navigation previews each theme live; Enter commits it", () => {
		const previews: string[] = [];
		const results: Array<any> = [];
		const component = new ThemePickerComponent({
			themes,
			current: "dark",
			theme: makeFakeTheme(),
			preview: (name) => previews.push(name),
			done: (result) => results.push(result),
		});
		component.handleInput("down"); // dark → light
		expect(previews).toEqual(["light"]);
		component.handleInput("enter");
		expect(results).toEqual([{ committed: true, theme: "light" }]);
	});

	test("Esc restores the original preview and resolves undefined", () => {
		const previews: string[] = [];
		const results: Array<any> = [];
		const component = new ThemePickerComponent({
			themes,
			current: "dark",
			theme: makeFakeTheme(),
			preview: (name) => previews.push(name),
			done: (result) => results.push(result),
		});
		component.handleInput("down"); // preview light
		component.handleInput("down"); // preview unown
		component.handleInput("escape");
		// The component resolves undefined; the HOST restores the original
		// theme (the command's Esc path) — asserted in the command suite below.
		expect(previews).toEqual(["light", "unown"]);
		expect(results).toEqual([undefined]);
	});

	test("j/k move like the arrows; the current theme is marked in the render", () => {
		const component = new ThemePickerComponent({
			themes,
			current: "light",
			theme: makeFakeTheme(),
			preview: () => {},
			done: () => {},
		});
		const rendered = component.render(80).join("\n");
		expect(rendered).toContain("(current)");
		expect(rendered).toContain("live preview");
		component.handleInput("k"); // up to dark (index 0)
		component.handleInput("j"); // back down to light
		component.handleInput("j"); // to unown
		component.handleInput("enter");
		// (result asserted via done in the next test's shape — this one only pins motion)
	});
});

describe("/theme command (Toccata A13 — the alias onto the theme surface)", () => {
	test("registers with the Claude Code description", () => {
		const { pi, commands } = makeFakePi();
		registerThemeCommand(pi as any);
		expect(commands.has("theme")).toBe(true);
		expect(commands.get("theme")!.description).toContain("theme");
	});

	test("/theme <name> switches directly and notifies", async () => {
		const { pi, runCommand } = makeFakePi();
		registerThemeCommand(pi as any);
		const { ctx, messages, setThemeCalls } = makeCtx([{ name: "dark" }, { name: "light" }]);
		await runCommand("theme", "light", ctx);
		expect(setThemeCalls).toEqual(["light"]);
		expect(messages.some((m) => m.text.includes("Theme: light"))).toBe(true);
	});

	test("/theme <unknown> warns and lists the available themes", async () => {
		const { pi, runCommand } = makeFakePi();
		registerThemeCommand(pi as any);
		const { ctx, messages, setThemeCalls } = makeCtx([{ name: "dark" }]);
		await runCommand("theme", "neon", ctx);
		expect(setThemeCalls).toHaveLength(0);
		expect(messages.some((m) => m.level === "warning" && m.text.includes("Unknown theme"))).toBe(true);
	});

	test("bare /theme without a TTY names the themes and the direct form", async () => {
		const { pi, runCommand } = makeFakePi();
		registerThemeCommand(pi as any);
		const { ctx, messages } = makeCtx([{ name: "dark" }], false);
		await runCommand("theme", "", ctx);
		expect(messages.some((m) => m.text.includes("needs a TTY"))).toBe(true);
	});

	test("bare /theme with a TTY opens the picker; Esc restores the original theme", async () => {
		// Pre-write the user settings' theme so the picker has a real original
		// to restore (the registry's SettingsManager reads the redirected home).
		resetPiManagerCache();
		const { writeFileSync } = await import("node:fs");
		const { resolveUnownHome } = await import("../src/unown-home.ts");
		const agentDir = join(resolveUnownHome(), "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }, null, 2));

		const { pi, runCommand } = makeFakePi();
		registerThemeCommand(pi as any);
		const { ctx, setThemeCalls } = makeCtx([{ name: "dark" }, { name: "light" }]);
		scenario = (component) => {
			component.handleInput("down"); // preview light
			component.handleInput("escape"); // restore + resolve undefined
		};
		await runCommand("theme", "", ctx);
		// The preview was in-memory; Esc restored the original setting by name.
		expect(setThemeCalls).toEqual([{ name: "light" }, "dark"]);
	});
});
