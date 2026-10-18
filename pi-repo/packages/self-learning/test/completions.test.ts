// completions.test.ts — every completion script mentions every command word.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import {
	bashCompletion,
	cmdCompletions,
	fishCompletion,
	powershellCompletion,
	zshCompletion,
} from "../src/completions.ts";

const ALL_COMMANDS = [
	"setup",
	"models",
	"init",
	"memory",
	"doctor",
	"note",
	"update",
	"changelog",
	"info",
	"completions",
	"uninstall",
];

describe("unown completions", () => {
	test("every shell script mentions every command + the update flags (drift guard)", () => {
		const scripts = {
			bash: bashCompletion(),
			zsh: zshCompletion(),
			fish: fishCompletion(),
			powershell: powershellCompletion(),
		};
		for (const [shell, script] of Object.entries(scripts)) {
			for (const cmd of ALL_COMMANDS) expect(script).toContain(cmd);
			for (const flag of ["--check", "--rollback", "--allow-dirty"]) expect(script).toContain(flag);
			// ASCII only — the powershell script must survive the ISE codepage,
			// and the repo keeps launchers ASCII on Windows by contract.
			expect(script).not.toMatch(/[^\x00-\x7F]/);
			expect(shell.length).toBeGreaterThan(0);
		}
	});

	test("cmdCompletions dispatch, usage, and unknown shell", () => {
		const lines: string[] = [];
		const log = (l: string) => lines.push(l);
		expect(cmdCompletions(["bash"], { log })).toBe(0);
		expect(cmdCompletions(["zsh"], { log })).toBe(0);
		expect(cmdCompletions(["fish"], { log })).toBe(0);
		expect(cmdCompletions(["powershell"], { log })).toBe(0);
		expect(cmdCompletions([], { log })).toBe(1);
		expect(cmdCompletions(["tcsh"], { log })).toBe(1);
		expect(lines.join("\n")).toContain("usage: unown completions");
	});
});
