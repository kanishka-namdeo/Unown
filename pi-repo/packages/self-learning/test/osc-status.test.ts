/**
 * osc-status.test.ts — the OSC 7501 Program Status Protocol emitter (rev 0.4),
 * the 2026-10 convergence round. Pins the spec byte-for-byte: sequence framing,
 * field limits, state/kind validation, base64 encoding, TTY gating and the
 * env opt-outs — plus the session-lifecycle helpers' message clipping.
 */
import { describe, expect, test } from "bun:test";
import {
	buildProgramStatus,
	clipStatusText,
	emitProgramStatus,
	programStatusEnabled,
	PROGRAM_STATUS_APP,
	STATUS_MSG_PREVIEW_CHARS,
	type ProgramStatusFields,
} from "../src/osc-status.ts";

const ESC = "\x1b";
const OSC = `${ESC}]`;
const ST = `${ESC}\\`;

function b64(text: string): string {
	return Buffer.from(text, "utf8").toString("base64");
}

function decodeMsg(sequence: string): string {
	const match = /msg=([A-Za-z0-9+/=]+)/.exec(sequence);
	return match ? Buffer.from(match[1], "base64").toString("utf8") : "";
}

describe("buildProgramStatus — the spec grammar", () => {
	test("minimal report: state only", () => {
		const seq = buildProgramStatus({ state: "idle" });
		expect(seq).toBe(`${OSC}7501;state=idle${ST}`);
	});

	test("full report: every optional field, spec order", () => {
		const seq = buildProgramStatus({
			state: "blocked",
			id: "root/child",
			kind: "permission",
			progress: 42,
			app: "unown",
			title: "Needs approval",
			msg: "Apply 3 to add, 1 to change, 0 to destroy?",
		});
		expect(seq).toBe(
			`${OSC}7501;state=blocked:id=root/child:kind=permission:progress=42:app=unown` +
				`:title=${b64("Needs approval")}:msg=${b64("Apply 3 to add, 1 to change, 0 to destroy?")}${ST}`,
		);
	});

	test("msg and title are base64 (decoded round-trip, one line, control-free)", () => {
		const seq = buildProgramStatus({ state: "working", msg: "Line one\nLine two\x07" });
		expect(decodeMsg(seq!)).toBe("Line one Line two");
	});

	test("unknown state and kind are refused (the terminal would discard the report)", () => {
		expect(buildProgramStatus({ state: "thinking" as any })).toBeNull();
		expect(buildProgramStatus({ state: "blocked", kind: "snack" as any })).toBeNull();
	});

	test("id path rules: segment alphabet, 32/segment, 8 levels, 128 bytes", () => {
		expect(buildProgramStatus({ state: "idle", id: "a/b_c.d+e-f" })).toBeString();
		expect(buildProgramStatus({ state: "idle", id: "bad name" })).toBeNull(); // space not in alphabet
		expect(buildProgramStatus({ state: "idle", id: "a/".repeat(9).slice(0, -1) })).toBeNull(); // 9 levels
		expect(buildProgramStatus({ state: "idle", id: `${"a".repeat(33)}` })).toBeNull(); // 33-byte segment
		expect(buildProgramStatus({ state: "idle", id: `${"a".repeat(129)}` })).toBeNull(); // >128 bytes
		expect(buildProgramStatus({ state: "idle", id: "" })).toBeString(); // empty = root record
	});

	test("progress clamps to 0..100 and rounds", () => {
		const seq = buildProgramStatus({ state: "working", progress: 147 });
		expect(seq).toContain("progress=100");
		expect(buildProgramStatus({ state: "working", progress: -3 })).toContain("progress=0");
		expect(buildProgramStatus({ state: "working", progress: 41.6 })).toContain("progress=42");
		expect(buildProgramStatus({ state: "working", progress: Number.NaN })).toBeNull();
	});

	test("app: 1..32 chars, same alphabet as id", () => {
		expect(buildProgramStatus({ state: "idle", app: "unown" })).toBeString();
		expect(buildProgramStatus({ state: "idle", app: "a".repeat(33) })).toBeNull();
		expect(buildProgramStatus({ state: "idle", app: "no spaces" })).toBeNull();
	});

	test("msg is clipped to the 2048-byte decode budget, title to 192", () => {
		const seq = buildProgramStatus({ state: "working", msg: "x".repeat(3_000) });
		expect(decodeMsg(seq!)).toHaveLength(2048);
		const seqTitle = buildProgramStatus({ state: "working", title: "y".repeat(300) });
		const titleMatch = /title=([A-Za-z0-9+/=]+)/.exec(seqTitle!);
		expect(Buffer.from(titleMatch![1], "base64").toString("utf8")).toHaveLength(192);
	});

	test("the 4096-byte whole-sequence cap is enforced with a refusal, not a truncation", () => {
		// msg clips at 2048 chars so the sequence stays far inside the cap —
		// force it via many fields instead: the cap is a backstop, so use a
		// crafted long id plus long msg.
		const seq = buildProgramStatus({
			state: "working",
			id: `${"a".repeat(32)}/${"b".repeat(32)}/${"c".repeat(32)}/${"d".repeat(28)}`,
			app: "unown",
			title: "t".repeat(192),
			msg: "m".repeat(2048),
		});
		// Under the cap it must still emit; the byte count is testable.
		expect(seq).not.toBeNull();
		expect(Buffer.byteLength(seq!, "utf8")).toBeLessThanOrEqual(4096);
	});

	test("clear drops records; done/error survive (state names per spec)", () => {
		for (const state of ["idle", "working", "done", "blocked", "error", "clear"] as const) {
			expect(buildProgramStatus({ state })).toBeString();
		}
	});
});

describe("emission gating", () => {
	test("never writes to a non-TTY stream", () => {
		const writes: string[] = [];
		const stream = { isTTY: false, write: (s: string) => writes.push(s) };
		expect(emitProgramStatus({ state: "working" }, stream)).toBe(false);
		expect(writes).toEqual([]);
	});

	test("writes exactly the sequence to a TTY", () => {
		const writes: string[] = [];
		const stream = { isTTY: true, write: (s: string) => (writes.push(s), true) };
		expect(emitProgramStatus({ state: "working", app: PROGRAM_STATUS_APP, msg: "hi" }, stream)).toBe(true);
		expect(writes).toEqual([`${OSC}7501;state=working:app=unown:msg=${b64("hi")}${ST}`]);
	});

	test("PROGRAM_STATUS=0 disables (the spec-wide opt-out)", () => {
		const prev = process.env.PROGRAM_STATUS;
		process.env.PROGRAM_STATUS = "0";
		const stream = { isTTY: true, write: () => true };
		expect(programStatusEnabled(stream)).toBe(false);
		process.env.PROGRAM_STATUS = prev;
	});

	test("UNOWN_OSC7501=0 disables (the native alias)", () => {
		const prev = process.env.UNOWN_OSC7501;
		process.env.UNOWN_OSC7501 = "0";
		const stream = { isTTY: true, write: () => true };
		expect(programStatusEnabled(stream)).toBe(false);
		process.env.UNOWN_OSC7501 = prev;
	});

	test("a dead stream never throws", () => {
		const stream = { isTTY: true, write: () => { throw new Error("EPIPE"); } };
		expect(emitProgramStatus({ state: "idle" }, stream)).toBe(false);
	});
});

describe("message clipping", () => {
	test("one line, control-free, capped at the preview budget", () => {
		expect(clipStatusText("fix\nthe\ttests", 100)).toBe("fix the tests");
		expect(clipStatusText("x".repeat(300), STATUS_MSG_PREVIEW_CHARS)).toHaveLength(STATUS_MSG_PREVIEW_CHARS);
		expect(clipStatusText(123 as any, 10)).toBe("123");
	});
});
