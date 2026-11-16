/**
 * notify-channel.test.ts — the Da capo R13 lane: the notification channel
 * resolver (OSC 777 on Ghostty/iTerm2/WezTerm, OSC 9 elsewhere), the
 * needs-input gate, and the deferred one-per-ask ping.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
	inputNeededPayload,
	inputNotifyEnabled,
	inputNotifyGated,
	resolveNotifyChannel,
	scheduleInputNeededPing,
} from "../src/notify-channel.ts";

const BASE_ENV = { UNOWN_TUI_NOTIFY: undefined, UNOWN_NOTIFY: undefined, DO_NOT_TRACK: undefined };

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
	return { ...BASE_ENV, ...overrides };
}

describe("resolveNotifyChannel", () => {
	test("defaults to OSC 9 with no terminal program", () => {
		expect(resolveNotifyChannel(envWith({}), undefined)).toBe("osc9");
	});

	test("detects Ghostty, iTerm2 and WezTerm via TERM_PROGRAM (case-insensitive)", () => {
		for (const program of ["ghostty", "Ghostty", "iTerm.app", "iterm2", "WezTerm", "wezterm"]) {
			expect(resolveNotifyChannel(envWith({}), program)).toBe("osc777", program);
		}
	});

	test("unrelated terminals stay on OSC 9", () => {
		for (const program of ["xterm-256color", "vscode", "Apple_Terminal", "tmux", undefined]) {
			expect(resolveNotifyChannel(envWith({}), program)).toBe("osc9");
		}
	});

	test("UNOWN_TUI_NOTIFY_CHANNEL pins the channel explicitly", () => {
		expect(resolveNotifyChannel(envWith({ UNOWN_TUI_NOTIFY_CHANNEL: "osc777" }), undefined)).toBe("osc777");
		expect(resolveNotifyChannel(envWith({ UNOWN_TUI_NOTIFY_CHANNEL: "osc9" }), "ghostty")).toBe("osc9");
	});

	test("an empty channel pin falls through to detection", () => {
		expect(resolveNotifyChannel(envWith({ UNOWN_TUI_NOTIFY_CHANNEL: "" }), "ghostty")).toBe("osc777");
	});

	test("reads TERM_PROGRAM from the env when the argument is omitted", () => {
		expect(resolveNotifyChannel(envWith({ TERM_PROGRAM: "ghostty" }))).toBe("osc777");
	});
});

describe("inputNotify gates", () => {
	test("enabled by default; 0/false/off disables", () => {
		expect(inputNotifyEnabled(envWith({}))).toBe(true);
		expect(inputNotifyEnabled(envWith({ UNOWN_TUI_NOTIFY_INPUT: "0" }))).toBe(false);
		expect(inputNotifyEnabled(envWith({ UNOWN_TUI_NOTIFY_INPUT: "false" }))).toBe(false);
		expect(inputNotifyEnabled(envWith({ UNOWN_TUI_NOTIFY_INPUT: "off" }))).toBe(false);
		expect(inputNotifyEnabled(envWith({ UNOWN_TUI_NOTIFY_INPUT: "1" }))).toBe(true);
	});

	test("a non-TTY never pings", () => {
		expect(inputNotifyGated(false, envWith({}))).toBe(false);
	});

	test("the family kill switches silence the input ping too", () => {
		expect(inputNotifyGated(true, envWith({ UNOWN_TUI_NOTIFY: "0" }))).toBe(false);
		expect(inputNotifyGated(true, envWith({ UNOWN_NOTIFY: "0" }))).toBe(false);
		expect(inputNotifyGated(true, envWith({ DO_NOT_TRACK: "1" }))).toBe(false);
	});

	test("a TTY with default env pings", () => {
		expect(inputNotifyGated(true, envWith({}))).toBe(true);
	});
});

describe("inputNeededPayload", () => {
	test("OSC 9 form keeps the +BEL belt-and-braces pair", () => {
		const payload = inputNeededPayload("edit src/boot.ts", "osc9");
		expect(payload).toContain("\x1b]9;unown needs your input — edit src/boot.ts\x07\x07");
	});

	test("OSC 777 form carries the notify;title;body shape", () => {
		const payload = inputNeededPayload("edit src/boot.ts", "osc777");
		expect(payload).toBe("\x1b]777;notify;unown;unown needs your input — edit src/boot.ts\x07");
	});

	test("collapses whitespace and caps the preview at 80 chars", () => {
		const long = "a".repeat(200);
		const payload = inputNeededPayload(`line1\nline2 ${long}`, "osc9");
		expect(payload).not.toContain("\n");
		expect(payload.length).toBeLessThan(160);
	});

	test("an empty reason still names the moment", () => {
		expect(inputNeededPayload("   ", "osc9")).toContain("unown needs your input");
	});
});

describe("scheduleInputNeededPing", () => {
	type FakeTimer = { fn: () => void; cancel(): void };

	function fakeTimers() {
		const timers: FakeTimer[] = [];
		const fired: string[] = [];
		const writes: string[] = [];
		const setTimeoutFn = (fn: () => void, _ms: number): FakeTimer => {
			const timer: FakeTimer = {
				fn,
				cancel: () => {
					const index = timers.indexOf(timer);
					if (index >= 0) timers.splice(index, 1);
				},
			};
			timers.push(timer);
			return timer;
		};
		return {
			setTimeoutFn,
			fire: () => {
				const timer = timers.shift();
				if (timer) {
					timer.fn();
					fired.push("yes");
				}
			},
			firedCount: () => fired.length,
			pending: () => timers.length,
			writes,
		};
	}

	test("schedules one deferred write on a TTY", () => {
		const t = fakeTimers();
		const handle = scheduleInputNeededPing("approve the edit", {
			isTty: true,
			env: envWith({}),
			write: (s) => t.writes.push(s),
			setTimeoutFn: t.setTimeoutFn,
		});
		expect(handle).not.toBeNull();
		expect(t.pending()).toBe(1);
		expect(t.writes).toHaveLength(0);
		t.fire();
		expect(t.writes).toHaveLength(1);
		expect(t.writes[0]).toContain("unown needs your input");
	});

	test("a cancelled ping (answered fast) never writes", () => {
		const t = fakeTimers();
		const handle = scheduleInputNeededPing("approve the edit", {
			isTty: true,
			env: envWith({}),
			write: (s) => t.writes.push(s),
			setTimeoutFn: t.setTimeoutFn,
		});
		handle?.cancel();
		t.fire();
		t.fire();
		expect(t.writes).toHaveLength(0);
		expect(t.firedCount()).toBe(0);
	});

	test("no ping without a TTY or with the input switch off", () => {
		const t = fakeTimers();
		expect(
			scheduleInputNeededPing("x", {
				isTty: false,
				env: envWith({}),
				write: (s) => t.writes.push(s),
				setTimeoutFn: t.setTimeoutFn,
			}),
		).toBeNull();
		expect(
			scheduleInputNeededPing("x", {
				isTty: true,
				env: envWith({ UNOWN_TUI_NOTIFY_INPUT: "0" }),
				write: (s) => t.writes.push(s),
				setTimeoutFn: t.setTimeoutFn,
			}),
		).toBeNull();
		expect(t.pending()).toBe(0);
	});

	test("the payload rides the resolved channel", () => {
		const t = fakeTimers();
		const writes: string[] = [];
		scheduleInputNeededPing("question", {
			isTty: true,
			env: envWith({ TERM_PROGRAM: "ghostty" }),
			write: (s) => writes.push(s),
			setTimeoutFn: t.setTimeoutFn,
		});
		t.fire();
		expect(writes[0]).toContain("\x1b]777;notify;");
	});
});

describe("environment hygiene", () => {
	let savedTermProgram: string | undefined;
	beforeEach(() => {
		savedTermProgram = process.env.TERM_PROGRAM;
	});
	test("the resolver never mutates process.env", () => {
		resolveNotifyChannel(envWith({ TERM_PROGRAM: "ghostty" }));
		expect(process.env.TERM_PROGRAM).toBe(savedTermProgram);
	});
});
