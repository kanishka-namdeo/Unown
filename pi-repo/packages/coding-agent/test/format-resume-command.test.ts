import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_NAME } from "../src/config.ts";
import type { SessionManager } from "../src/core/session-manager.ts";
import { formatResumeCommand } from "../src/modes/interactive/interactive-mode.ts";

const tempDirs: string[] = [];
const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalMsystem = process.env.MSYSTEM;

afterEach(() => {
	if (originalStdoutIsTTY) {
		Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
	} else {
		Reflect.deleteProperty(process.stdout, "isTTY");
	}
	if (originalPlatform) {
		Object.defineProperty(process, "platform", originalPlatform);
	}
	if (originalMsystem === undefined) {
		delete process.env.MSYSTEM;
	} else {
		process.env.MSYSTEM = originalMsystem;
	}

	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function setStdoutIsTTY(value: boolean): void {
	Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

/** Simulate the host platform (the quoting decision reads it at call time). */
function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { configurable: true, value: platform });
}

function createTempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-format-resume-command-"));
	tempDirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, "\n");
	return file;
}

function createSessionManager(options: {
	persisted?: boolean;
	sessionFile?: string;
	sessionId?: string;
	sessionDir?: string;
	usesDefaultSessionDir?: boolean;
}): SessionManager {
	return {
		isPersisted: () => options.persisted ?? true,
		getSessionFile: () => options.sessionFile,
		getSessionId: () => options.sessionId ?? "0197f6e4-4cf9-7f44-a2d8-f8f7f49ee9d3",
		getSessionDir: () => options.sessionDir ?? "/tmp/pi-sessions",
		usesDefaultSessionDir: () => options.usesDefaultSessionDir ?? true,
	} as unknown as SessionManager;
}

describe("formatResumeCommand", () => {
	it("returns a session resume command for default session dirs", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile, sessionId: "test-session" });

		expect(formatResumeCommand(sessionManager)).toBe(`${APP_NAME} --session test-session`);
	});

	it("includes unquoted safe session dirs for non-default session dirs", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "/tmp/custom-pi-sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir /tmp/custom-pi-sessions --session test-session`,
		);
	});

	it("quotes session dirs containing spaces", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "/tmp/custom pi sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir '/tmp/custom pi sessions' --session test-session`,
		);
	});

	it("quotes session dirs containing single quotes", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "/tmp/custom pi's sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir '/tmp/custom pi'\\''s sessions' --session test-session`,
		);
	});

	it("returns undefined when stdout is not a TTY", () => {
		setStdoutIsTTY(false);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile });

		expect(formatResumeCommand(sessionManager)).toBeUndefined();
	});

	it("returns undefined for in-memory sessions", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ persisted: false, sessionFile });

		expect(formatResumeCommand(sessionManager)).toBeUndefined();
	});

	it("returns undefined when the session file is missing", () => {
		setStdoutIsTTY(true);
		const sessionManager = createSessionManager({ sessionFile: "/tmp/pi-missing-session.jsonl" });

		expect(formatResumeCommand(sessionManager)).toBeUndefined();
	});

	it("returns undefined when the session file is not set", () => {
		setStdoutIsTTY(true);
		const sessionManager = createSessionManager({ sessionFile: undefined });

		expect(formatResumeCommand(sessionManager)).toBeUndefined();
	});

	it("names the launcher passed via appName instead of the vendored app name", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile, sessionId: "test-session" });

		expect(formatResumeCommand(sessionManager, { appName: "unown" })).toBe(`unown --session test-session`);
	});

	it("uses the launcher-provided buildResumeCommand when supplied", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile, sessionId: "0197f6e4-4cf9-7f44" });

		expect(
			formatResumeCommand(sessionManager, {
				appName: "unown",
				buildResumeCommand: (sessionId) => `unown --resume ${sessionId}`,
			}),
		).toBe("unown --resume 0197f6e4-4cf9-7f44");
	});

	it("falls back to the default builder when the launcher override declines", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile, sessionId: "test-session" });

		expect(
			formatResumeCommand(sessionManager, {
				appName: "unown",
				buildResumeCommand: () => undefined,
			}),
		).toBe("unown --session test-session");
	});

	it("double-quotes Windows session dirs (cmd.exe has no single-quote syntax)", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		delete process.env.MSYSTEM;
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "C:\\Users\\kanis\\.unown\\agent\\sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir "C:\\Users\\kanis\\.unown\\agent\\sessions" --session test-session`,
		);
	});

	it("double-quotes Windows session dirs containing spaces", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		delete process.env.MSYSTEM;
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "C:\\Users\\kanis\\My Sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir "C:\\Users\\kanis\\My Sessions" --session test-session`,
		);
	});

	it("escapes embedded double quotes on Windows", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		delete process.env.MSYSTEM;
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: 'C:\\we"ird',
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir "C:\\we\\"ird" --session test-session`,
		);
	});

	// CodeQL js/incomplete-sanitization (alert #86, the 2026-11-11 Recital
	// dependency-hygiene round): the MSVCRT escape now doubles backslash runs
	// adjacent to a quote (or the closing quote) — pinned both directions.
	it("doubles backslash runs directly before an embedded quote (CommandLineToArgvW 2n+1 rule)", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		delete process.env.MSYSTEM;
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: 'C:\\we\\"ird',
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir "C:\\we\\\\\\"ird" --session test-session`,
		);
	});

	it("doubles a trailing backslash run so the closing quote still closes (the swallowed-quote class)", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		delete process.env.MSYSTEM;
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "C:\\dir\\",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir "C:\\dir\\\\" --session test-session`,
		);
	});

	it("keeps POSIX single quotes under MSYS/Git Bash on Windows", () => {
		setStdoutIsTTY(true);
		setPlatform("win32");
		process.env.MSYSTEM = "MINGW64";
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({
			sessionFile,
			sessionId: "test-session",
			sessionDir: "/c/Users/kanis/My Sessions",
			usesDefaultSessionDir: false,
		});

		expect(formatResumeCommand(sessionManager)).toBe(
			`${APP_NAME} --session-dir '/c/Users/kanis/My Sessions' --session test-session`,
		);
	});

	it("quotes session ids that contain shell metacharacters", () => {
		setStdoutIsTTY(true);
		const sessionFile = createTempFile();
		const sessionManager = createSessionManager({ sessionFile, sessionId: "a b" });

		expect(formatResumeCommand(sessionManager)).toBe(`${APP_NAME} --session 'a b'`);
	});
});
